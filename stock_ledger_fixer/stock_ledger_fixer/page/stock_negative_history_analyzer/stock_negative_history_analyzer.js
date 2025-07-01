frappe.pages['stock-negative-history-analyzer'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Stock Negative History Analyzer',
		single_column: true
	});

	frappe.stock_negative_history_analyzer = new StockNegativeHistoryAnalyzer(page);
}

class StockNegativeHistoryAnalyzer {
	constructor(page) {
		this.page = page;
		this.make_filters();
		this.make_results_area();
		this.bind_events();
	}

	make_filters() {
		let me = this;
		
		// Stock Entry filter
		this.stock_entry = this.page.add_field({
			label: 'Stock Entry',
			fieldtype: 'Link',
			fieldname: 'stock_entry',
			options: 'Stock Entry',
			placeholder: 'Enter Stock Entry ID (e.g., STE-2025-09261)',
			change: () => this.analyze_stock_entry()
		});

		// Item Code filter (alternative to stock entry)
		this.item_code = this.page.add_field({
			label: 'Item Code (Alternative)',
			fieldtype: 'Link',
			fieldname: 'item_code',
			options: 'Item',
			placeholder: 'Or enter Item Code directly',
			change: () => this.analyze_item_directly()
		});

		// Warehouse filter
		this.warehouse = this.page.add_field({
			label: 'Warehouse',
			fieldtype: 'Link',
			fieldname: 'warehouse',
			options: 'Warehouse',
			placeholder: 'Optional: Filter by warehouse'
		});

		// Stock Entry Type filter
		this.stock_entry_type = this.page.add_field({
			label: 'Stock Entry Type',
			fieldtype: 'Select',
			fieldname: 'stock_entry_type',
			options: [
				{ label: 'All Types', value: '' },
				{ label: 'Material Issue', value: 'Material Issue' },
				{ label: 'Material Receipt', value: 'Material Receipt' },
				{ label: 'Material Transfer', value: 'Material Transfer' },
				{ label: 'Material Transfer for Manufacture', value: 'Material Transfer for Manufacture' },
				{ label: 'Manufacture', value: 'Manufacture' },
				{ label: 'Repack', value: 'Repack' },
				{ label: 'Send to Subcontractor', value: 'Send to Subcontractor' },
				{ label: 'Material Consumption for Manufacture', value: 'Material Consumption for Manufacture' }
			],
			default: '',
			placeholder: 'Optional: Filter by stock entry type'
		});

		// Analysis depth
		this.analysis_depth = this.page.add_field({
			label: 'Analysis Depth',
			fieldtype: 'Select',
			fieldname: 'analysis_depth',
			options: [
				{ label: 'Last 30 entries', value: '30' },
				{ label: 'Last 50 entries', value: '50' },
				{ label: 'Last 100 entries', value: '100' },
				{ label: 'All entries (may be slow)', value: 'all' }
			],
			default: '50'
		});

		// Action buttons
		this.page.add_inner_button('Analyze Stock Entry', () => this.analyze_stock_entry());
		this.page.add_inner_button('Find Negative Stock Items', () => this.find_negative_stock_items());
		this.page.add_inner_button('Export Analysis', () => this.export_analysis());
	}

	make_results_area() {
		// Summary section
		this.summary_area = $(`
			<div class="summary-section" style="margin: 20px 0; padding: 15px; background: #f8f9fa; border-radius: 6px;">
				<h4>Analysis Summary</h4>
				<div class="row summary-stats">
					<div class="col-md-3">
						<div class="stat-card">
							<div class="stat-number" id="analyzed-items">-</div>
							<div class="stat-label">Items Analyzed</div>
						</div>
					</div>
					<div class="col-md-3">
						<div class="stat-card">
							<div class="stat-number text-danger" id="negative-items">-</div>
							<div class="stat-label">Negative Stock Items</div>
						</div>
					</div>
					<div class="col-md-3">
						<div class="stat-card">
							<div class="stat-number text-warning" id="first-negative-date">-</div>
							<div class="stat-label">First Negative Date</div>
						</div>
					</div>
					<div class="col-md-3">
						<div class="stat-card">
							<div class="stat-number text-info" id="total-shortage">-</div>
							<div class="stat-label">Total Shortage</div>
						</div>
					</div>
				</div>
			</div>
		`).appendTo(this.page.main);

		// Tabs for different views
		this.tabs_area = $(`
			<div class="analysis-tabs">
				<ul class="nav nav-tabs" role="tablist">
					<li class="nav-item">
						<a class="nav-link active" id="overview-tab" role="tab" data-tab="overview">Overview</a>
					</li>
					<li class="nav-item">
						<a class="nav-link" id="timeline-tab" role="tab" data-tab="timeline">Timeline Analysis</a>
					</li>
					<li class="nav-item">
						<a class="nav-link" id="items-tab" role="tab" data-tab="items">Item Details</a>
					</li>
					<li class="nav-item">
						<a class="nav-link" id="recommendations-tab" role="tab" data-tab="recommendations">Recommendations</a>
					</li>
				</ul>
				<div class="tab-content">
					<div class="tab-pane fade show active" id="overview" role="tabpanel">
						<div id="overview-content"></div>
					</div>
					<div class="tab-pane fade" id="timeline" role="tabpanel">
						<div id="timeline-content"></div>
					</div>
					<div class="tab-pane fade" id="items" role="tabpanel">
						<div id="items-content"></div>
					</div>
					<div class="tab-pane fade" id="recommendations" role="tabpanel">
						<div id="recommendations-content"></div>
					</div>
				</div>
			</div>
		`).appendTo(this.page.main);
	}

	bind_events() {
		// Custom tab switching to avoid Frappe routing issues
		let me = this;
		this.tabs_area.find('a[role="tab"]').on('click', function(e) {
			e.preventDefault();
			e.stopPropagation();
			
			const target_tab = $(this).attr('data-tab');
			
			// Remove active class from all tabs and content
			me.tabs_area.find('a[role="tab"]').removeClass('active');
			me.tabs_area.find('.tab-pane').removeClass('show active');
			
			// Add active class to clicked tab and corresponding content
			$(this).addClass('active');
			me.tabs_area.find(`#${target_tab}`).addClass('show active');
		});
	}

	async analyze_stock_entry() {
		let stock_entry_name = this.stock_entry.get_value();
		
		if (!stock_entry_name) {
			frappe.msgprint('Please enter a Stock Entry ID');
			return;
		}

		frappe.show_progress('Analyzing Stock Entry...', 30, 100);
		
		try {
			let response = await frappe.call({
				method: 'stock_ledger_fixer.stock_ledger_fixer.page.stock_negative_history_analyzer.stock_negative_history_analyzer.analyze_stock_entry_negative_history',
				args: {
					stock_entry_name: stock_entry_name,
					warehouse: this.warehouse.get_value(),
					analysis_depth: this.analysis_depth.get_value()
				}
			});

			frappe.show_progress('Analyzing Stock Entry...', 80, 100);

			if (response.message.status === 'success') {
				this.render_analysis_results(response.message);
			} else {
				frappe.msgprint({
					title: 'Analysis Error',
					indicator: 'red',
					message: response.message.message || 'Failed to analyze stock entry'
				});
			}
		} catch (error) {
			console.error('Error analyzing stock entry:', error);
			frappe.msgprint({
				title: 'Error',
				indicator: 'red',
				message: 'Failed to analyze stock entry. Please check console for details.'
			});
		} finally {
			frappe.hide_progress();
		}
	}

	async analyze_item_directly() {
		let item_code = this.item_code.get_value();
		
		if (!item_code) {
			return;
		}

		frappe.show_progress('Analyzing Item History...', 30, 100);
		
		try {
			let response = await frappe.call({
				method: 'stock_ledger_fixer.stock_ledger_fixer.page.stock_negative_history_analyzer.stock_negative_history_analyzer.analyze_item_negative_history',
				args: {
					item_code: item_code,
					warehouse: this.warehouse.get_value(),
					analysis_depth: this.analysis_depth.get_value()
				}
			});

			if (response.message.status === 'success') {
				this.render_item_analysis_results(response.message);
			} else {
				frappe.msgprint('Failed to analyze item history');
			}
		} catch (error) {
			console.error('Error analyzing item:', error);
			frappe.msgprint('Failed to analyze item history');
		} finally {
			frappe.hide_progress();
		}
	}

	async find_negative_stock_items() {
		frappe.show_progress('Finding Negative Stock Items...', 30, 100);
		
		try {
			let response = await frappe.call({
				method: 'stock_ledger_fixer.stock_ledger_fixer.page.stock_negative_history_analyzer.stock_negative_history_analyzer.find_all_negative_stock_items',
				args: {
					warehouse: this.warehouse.get_value(),
					stock_entry_type: this.stock_entry_type.get_value()
				}
			});

			if (response.message.status === 'success') {
				this.render_negative_items_list(response.message.data, response.message.filter_applied);
			} else {
				frappe.msgprint('Failed to find negative stock items');
			}
		} catch (error) {
			console.error('Error finding negative stock items:', error);
			frappe.msgprint('Failed to find negative stock items');
		} finally {
			frappe.hide_progress();
		}
	}

	render_analysis_results(data) {
		// Update summary
		$('#analyzed-items').text(data.summary.items_analyzed || 0);
		$('#negative-items').text(data.summary.negative_items || 0);
		$('#first-negative-date').text(data.summary.first_negative_date || 'N/A');
		$('#total-shortage').text(frappe.format(data.summary.total_shortage || 0, {fieldtype: 'Float', precision: 2}));

		// Render overview
		this.render_overview(data.overview);
		
		// Render timeline
		this.render_timeline(data.timeline);
		
		// Render item details
		this.render_item_details(data.items);
		
		// Render recommendations
		this.render_recommendations(data.recommendations);
	}

	render_item_analysis_results(response) {
		// For single item analysis, we need to adapt the structure to match what render_analysis_results expects
		if (!response.data) {
			frappe.msgprint('No analysis data received');
			return;
		}

		const item_data = response.data;
		const timeline = response.timeline || [];

		// Create adapted data structure
		const adapted_data = {
			summary: {
				items_analyzed: 1,
				negative_items: item_data.current_balance < 0 ? 1 : 0,
				first_negative_date: item_data.first_negative_date || 'N/A',
				total_shortage: item_data.current_balance < 0 ? Math.abs(item_data.current_balance) : 0
			},
			overview: {
				stock_entry_name: 'Direct Item Analysis',
				stock_entry_type: 'Item Analysis',
				purpose: 'Direct Item History Analysis',
				posting_date: item_data.last_transaction_date || 'N/A',
				company: 'N/A',
				total_items: 1,
				items_with_issues: item_data.current_balance < 0 ? 1 : 0,
				expected_sles: item_data.total_entries,
				actual_sles: item_data.total_entries,
				issues: item_data.current_balance < 0 ? [{
					type: 'Negative Stock',
					severity: 'High',
					description: `Item ${item_data.item_code} has negative balance: ${item_data.current_balance}`
				}] : []
			},
			timeline: timeline,
			items: [item_data],
			recommendations: this.generate_item_recommendations(item_data)
		};

		// Use the existing render method with adapted data
		this.render_analysis_results(adapted_data);
	}

	generate_item_recommendations(item_data) {
		const recommendations = [];

		if (item_data.current_balance < 0) {
			recommendations.push({
				title: "Address Negative Stock",
				priority: "High",
				description: `Item ${item_data.item_code} has negative stock of ${item_data.current_balance}`,
				action: "Conduct physical inventory count and create Stock Reconciliation to correct balance",
				estimated_impact: "Will resolve negative stock and improve inventory accuracy"
			});
		}

		if (item_data.negative_periods && item_data.negative_periods.length > 0) {
			const hasLongNegativePeriods = item_data.negative_periods.some(period => period.duration_days > 30);
			if (hasLongNegativePeriods) {
				recommendations.push({
					title: "Review Inventory Management Process",
					priority: "Medium",
					description: "Item has been in negative stock for extended periods",
					action: "Review purchasing and manufacturing processes. Consider implementing automated reorder points",
					estimated_impact: "Will prevent future negative stock occurrences"
				});
			}
		}

		if (recommendations.length === 0) {
			recommendations.push({
				title: "Stock Status is Healthy",
				priority: "Low",
				description: "No immediate issues detected with this item's stock",
				action: "Continue regular monitoring to maintain stock health",
				estimated_impact: "Preventive measure to catch issues early"
			});
		}

		return recommendations;
	}

	render_overview(overview) {
		if (!overview) return;

		let overview_html = `
			<div class="overview-section" style="padding: 20px;">
				<h5>Stock Entry Analysis</h5>
				<div class="row">
					<div class="col-md-6">
						<table class="table table-sm">
							<tr><td><strong>Stock Entry:</strong></td><td>${overview.stock_entry_name}</td></tr>
							<tr><td><strong>Type:</strong></td><td>${overview.stock_entry_type}</td></tr>
							<tr><td><strong>Purpose:</strong></td><td>${overview.purpose}</td></tr>
							<tr><td><strong>Posting Date:</strong></td><td>${overview.posting_date}</td></tr>
							<tr><td><strong>Company:</strong></td><td>${overview.company}</td></tr>
						</table>
					</div>
					<div class="col-md-6">
						<table class="table table-sm">
							<tr><td><strong>Total Items:</strong></td><td>${overview.total_items}</td></tr>
							<tr><td><strong>Items with Issues:</strong></td><td class="text-danger">${overview.items_with_issues}</td></tr>
							<tr><td><strong>Expected SLEs:</strong></td><td>${overview.expected_sles}</td></tr>
							<tr><td><strong>Actual SLEs:</strong></td><td>${overview.actual_sles}</td></tr>
						</table>
					</div>
				</div>
				
				${overview.issues && overview.issues.length > 0 ? `
					<h6>Identified Issues:</h6>
					<div class="issues-list">
						${overview.issues.map(issue => `
							<div class="alert alert-${issue.severity === 'Critical' ? 'danger' : issue.severity === 'High' ? 'warning' : 'info'}" style="margin-bottom: 10px;">
								<strong>${issue.type}:</strong> ${issue.description}
							</div>
						`).join('')}
					</div>
				` : ''}
			</div>
		`;

		$('#overview-content').html(overview_html);
	}

	render_timeline(timeline) {
		if (!timeline || !timeline.length) {
			$('#timeline-content').html('<p class="text-muted" style="padding: 20px;">No timeline data available</p>');
			return;
		}

		let timeline_html = `
			<div class="timeline-section" style="padding: 20px;">
				<h5>Stock Movement Timeline</h5>
				<div class="table-responsive">
					<table class="table table-striped table-sm">
						<thead>
							<tr>
								<th>Date/Time</th>
								<th>Document</th>
								<th>Item</th>
								<th>Warehouse</th>
								<th>Batch</th>
								<th>Qty Change</th>
								<th>Balance After</th>
								<th>Status</th>
							</tr>
						</thead>
						<tbody>
							${timeline.map(entry => `
								<tr class="${entry.qty_after_transaction < 0 ? 'table-danger' : ''}">
									<td>${frappe.datetime.str_to_user(entry.posting_date)} ${entry.posting_time ? entry.posting_time.substring(0, 8) : ''}</td>
									<td>
										<small>${entry.voucher_type}</small><br>
										<strong>${entry.voucher_no}</strong>
									</td>
									<td>${entry.item_code || 'N/A'}</td>
									<td>${entry.warehouse}</td>
									<td>${entry.batch_no || 'No Batch'}</td>
									<td class="${entry.actual_qty < 0 ? 'text-danger' : 'text-success'}">
										${frappe.format(entry.actual_qty, {fieldtype: 'Float', precision: 2})}
									</td>
									<td class="${entry.qty_after_transaction < 0 ? 'text-danger' : ''}">
										${frappe.format(entry.qty_after_transaction, {fieldtype: 'Float', precision: 2})}
									</td>
									<td>
										${entry.qty_after_transaction < 0 ? 
											'<span class="badge badge-danger">Negative</span>' : 
											'<span class="badge badge-success">Positive</span>'}
									</td>
								</tr>
							`).join('')}
						</tbody>
					</table>
				</div>
			</div>
		`;

		$('#timeline-content').html(timeline_html);
	}

	render_item_details(items) {
		if (!items || !items.length) {
			$('#items-content').html('<p class="text-muted" style="padding: 20px;">No item details available</p>');
			return;
		}

		let items_html = `
			<div class="items-section" style="padding: 20px;">
				<h5>Item Analysis Details</h5>
				${items.map(item => `
					<div class="item-card" style="margin-bottom: 20px; padding: 15px; border: 1px solid #dee2e6; border-radius: 6px;">
						<h6>${item.item_code} ${item.current_balance < 0 ? '<span class="badge badge-danger">Negative Stock</span>' : '<span class="badge badge-success">Positive Stock</span>'}</h6>
						
						<div class="row">
							<div class="col-md-6">
								<table class="table table-sm">
									<tr><td><strong>Current Balance:</strong></td><td class="${item.current_balance < 0 ? 'text-danger' : ''}">${frappe.format(item.current_balance, {fieldtype: 'Float', precision: 2})}</td></tr>
									<tr><td><strong>Primary Warehouse:</strong></td><td>${item.primary_warehouse || 'Multiple'}</td></tr>
									<tr><td><strong>Primary Batch:</strong></td><td>${item.primary_batch || 'Multiple/None'}</td></tr>
								</table>
							</div>
							<div class="col-md-6">
								<table class="table table-sm">
									<tr><td><strong>First Negative Date:</strong></td><td>${item.first_negative_date || 'Never'}</td></tr>
									<tr><td><strong>Total Entries:</strong></td><td>${item.total_entries}</td></tr>
									<tr><td><strong>Last Transaction:</strong></td><td>${item.last_transaction_date}</td></tr>
								</table>
							</div>
						</div>

						${item.negative_periods && item.negative_periods.length > 0 ? `
							<h6 style="margin-top: 15px;">Negative Stock Periods:</h6>
							<div class="table-responsive">
								<table class="table table-sm table-striped">
									<thead>
										<tr>
											<th>Start Date</th>
											<th>End Date</th>
											<th>Duration</th>
											<th>Min Balance</th>
											<th>Trigger Document</th>
										</tr>
									</thead>
									<tbody>
										${item.negative_periods.map(period => `
											<tr>
												<td>${period.start_date}</td>
												<td>${period.end_date || 'Ongoing'}</td>
												<td>${period.duration_days} days</td>
												<td class="text-danger">${frappe.format(period.min_balance, {fieldtype: 'Float', precision: 2})}</td>
												<td>${period.trigger_document}</td>
											</tr>
										`).join('')}
									</tbody>
								</table>
							</div>
						` : ''}
					</div>
				`).join('')}
			</div>
		`;

		$('#items-content').html(items_html);
	}

	render_recommendations(recommendations) {
		if (!recommendations || !recommendations.length) {
			$('#recommendations-content').html('<p class="text-muted" style="padding: 20px;">No recommendations available</p>');
			return;
		}

		let recommendations_html = `
			<div class="recommendations-section" style="padding: 20px;">
				<h5>Recommended Actions</h5>
				${recommendations.map((rec, index) => `
					<div class="recommendation-item" style="margin-bottom: 15px; padding: 15px; border-left: 4px solid var(--${rec.priority === 'High' ? 'danger' : rec.priority === 'Medium' ? 'warning' : 'info'}); background: #f8f9fa;">
						<div class="d-flex justify-content-between align-items-start">
							<div style="width: 100%;">
								<h6 class="text-${rec.priority === 'High' ? 'danger' : rec.priority === 'Medium' ? 'warning' : 'info'}">
									${index + 1}. ${rec.title}
									<span class="badge badge-${rec.priority === 'High' ? 'danger' : rec.priority === 'Medium' ? 'warning' : 'info'} ml-2">${rec.priority}</span>
								</h6>
								<p class="mb-1">${rec.description}</p>
								<small class="text-muted"><strong>Action:</strong> ${rec.action}</small>
								${rec.estimated_impact ? `<br><small class="text-muted"><strong>Impact:</strong> ${rec.estimated_impact}</small>` : ''}
							</div>
						</div>
					</div>
				`).join('')}
			</div>
		`;

		$('#recommendations-content').html(recommendations_html);
	}

	render_negative_items_list(items, filter_applied = {}) {
		if (!items || !items.length) {
			frappe.msgprint('No items with negative stock found');
			return;
		}

		// Show filter information
		let filter_info = '';
		if (filter_applied.warehouse || filter_applied.stock_entry_type) {
			filter_info = `
				<div class="alert alert-info">
					<strong>Filters Applied:</strong>
					${filter_applied.warehouse ? `Warehouse: ${filter_applied.warehouse}` : ''}
					${filter_applied.warehouse && filter_applied.stock_entry_type ? ', ' : ''}
					${filter_applied.stock_entry_type ? `Stock Entry Type: ${filter_applied.stock_entry_type}` : ''}
				</div>
			`;
		}

		// Create a modal to show the negative items
		let modal_content = `
			<div class="modal fade" id="negative-items-modal" tabindex="-1">
				<div class="modal-dialog modal-xl">
					<div class="modal-content">
						<div class="modal-header">
							<h5 class="modal-title">Items with Negative Stock (${items.length} items)</h5>
							<button type="button" class="close" data-dismiss="modal">&times;</button>
						</div>
						<div class="modal-body">
							${filter_info}
							<div class="table-responsive">
								<table class="table table-striped">
									<thead>
										<tr>
											<th>Item Code</th>
											<th>Warehouse</th>
											<th>Current Balance</th>
											<th>First Negative Date</th>
											<th>Total Entries</th>
											${filter_applied.stock_entry_type ? '<th>Filtered Type Entries</th>' : ''}
											<th>Related Entry Types</th>
											<th>Actions</th>
										</tr>
									</thead>
									<tbody>
										${items.map(item => `
											<tr>
												<td>${item.item_code}</td>
												<td>${item.warehouse}</td>
												<td class="text-danger">${frappe.format(item.current_balance, {fieldtype: 'Float', precision: 2})}</td>
												<td>${item.first_negative_date || 'N/A'}</td>
												<td>${item.total_entries}</td>
												${filter_applied.stock_entry_type ? `<td class="text-info">${item.filtered_type_entries || 0}</td>` : ''}
												<td><small>${item.related_entry_types || 'N/A'}</small></td>
												<td>
													<button class="btn btn-sm btn-primary analyze-item-btn" data-item="${item.item_code}" data-warehouse="${item.warehouse}">
														Analyze
													</button>
												</td>
											</tr>
										`).join('')}
									</tbody>
								</table>
							</div>
						</div>
						<div class="modal-footer">
							<button type="button" class="btn btn-secondary" data-dismiss="modal">Close</button>
						</div>
					</div>
				</div>
			</div>
		`;

		// Remove existing modal and add new one
		$('#negative-items-modal').remove();
		$('body').append(modal_content);
		$('#negative-items-modal').modal('show');

		// Bind analyze button events
		$(document).on('click', '.analyze-item-btn', (e) => {
			let item_code = $(e.target).data('item');
			let warehouse = $(e.target).data('warehouse');
			
			this.item_code.set_value(item_code);
			this.warehouse.set_value(warehouse);
			$('#negative-items-modal').modal('hide');
			this.analyze_item_directly();
		});
	}

	export_analysis() {
		// Implementation for exporting the analysis results
		frappe.msgprint('Export functionality will be implemented');
	}

	render_item_analysis_results(response) {
		// For single item analysis, we need to adapt the structure to match what render_analysis_results expects
		if (!response.data) {
			frappe.msgprint('No analysis data received');
			return;
		}

		const item_data = response.data;
		const timeline = response.timeline || [];

		// Create adapted data structure
		const adapted_data = {
			summary: {
				items_analyzed: 1,
				negative_items: item_data.current_balance < 0 ? 1 : 0,
				first_negative_date: item_data.first_negative_date || 'N/A',
				total_shortage: item_data.current_balance < 0 ? Math.abs(item_data.current_balance) : 0
			},
			overview: {
				stock_entry_name: 'Direct Item Analysis',
				stock_entry_type: 'Item Analysis',
				purpose: 'Direct Item History Analysis',
				posting_date: item_data.last_transaction_date || 'N/A',
				company: 'N/A',
				total_items: 1,
				items_with_issues: item_data.current_balance < 0 ? 1 : 0,
				expected_sles: item_data.total_entries,
				actual_sles: item_data.total_entries,
				issues: item_data.current_balance < 0 ? [{
					type: 'Negative Stock',
					severity: 'High',
					description: `Item ${item_data.item_code} has negative balance: ${item_data.current_balance}`
				}] : []
			},
			timeline: timeline,
			items: [item_data],
			recommendations: this.generate_item_recommendations(item_data)
		};

		// Use the existing render method with adapted data
		this.render_analysis_results(adapted_data);
	}

	generate_item_recommendations(item_data) {
		const recommendations = [];

		if (item_data.current_balance < 0) {
			recommendations.push({
				title: "Address Negative Stock",
				priority: "High",
				description: `Item ${item_data.item_code} has negative stock of ${item_data.current_balance}`,
				action: "Conduct physical inventory count and create Stock Reconciliation to correct balance",
				estimated_impact: "Will resolve negative stock and improve inventory accuracy"
			});
		}

		if (item_data.negative_periods && item_data.negative_periods.length > 0) {
			const hasLongNegativePeriods = item_data.negative_periods.some(period => period.duration_days > 30);
			if (hasLongNegativePeriods) {
				recommendations.push({
					title: "Review Inventory Management Process",
					priority: "Medium",
					description: "Item has been in negative stock for extended periods",
					action: "Review purchasing and manufacturing processes. Consider implementing automated reorder points",
					estimated_impact: "Will prevent future negative stock occurrences"
				});
			}
		}

		if (recommendations.length === 0) {
			recommendations.push({
				title: "Stock Status is Healthy",
				priority: "Low",
				description: "No immediate issues detected with this item's stock",
				action: "Continue regular monitoring to maintain stock health",
				estimated_impact: "Preventive measure to catch issues early"
			});
		}

		return recommendations;
	}
}
