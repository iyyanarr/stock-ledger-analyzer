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

		// Item Code filter for negative items search
		this.filter_item_code = this.page.add_field({
			label: 'Filter by Item Code',
			fieldtype: 'Link',
			fieldname: 'filter_item_code',
			options: 'Item',
			placeholder: 'Optional: Filter negative items by specific item code'
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
						<a class="nav-link" id="negative-items-tab" role="tab" data-tab="negative-items">Negative Items</a>
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
					<div class="tab-pane fade" id="negative-items" role="tabpanel">
						<div id="negative-items-content"></div>
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
			
			// If switching to negative items tab and it's empty, show instruction
			if (target_tab === 'negative-items' && $('#negative-items-content').is(':empty')) {
				$('#negative-items-content').html(`
					<div style="padding: 20px; text-align: center;">
						<p class="text-muted">Click "Find Negative Stock Items" button above to search for items with negative stock.</p>
					</div>
				`);
			}
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
		if (!this.warehouse || !this.stock_entry_type || !this.filter_item_code) {
			console.warn('Required filters not initialized yet');
			return;
		}

		frappe.show_progress('Finding Negative Stock Items...', 30, 100);
		
		try {
			let response = await frappe.call({
				method: 'stock_ledger_fixer.stock_ledger_fixer.page.stock_negative_history_analyzer.stock_negative_history_analyzer.find_all_negative_stock_items',
				args: {
					warehouse: this.warehouse.get_value(),
					stock_entry_type: this.stock_entry_type.get_value(),
					item_code: this.filter_item_code.get_value()
				},
				freeze: true,
				freeze_message: 'Finding Negative Stock Items...'
			});

			if (response && response.message && response.message.status === 'success') {
				this.render_negative_items_list(response.message.data, response.message.filter_applied);
			} else {
				console.error('Invalid response:', response);
				frappe.msgprint('Failed to find negative stock items: Invalid response');
			}
		} catch (error) {
			console.error('Error finding negative stock items:', error);
			if (error.exc_type) {
				frappe.msgprint(`Error: ${error.exc_type} - ${error.exc}`);
			} else {
				frappe.msgprint('Failed to find negative stock items. Please try again.');
			}
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

		console.log('Analysis Data:', data); // Debug log
		console.log('Items Data:', data.items); // Debug log

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
		if (!overview) {
			$('#overview-content').html('<p class="text-muted" style="padding: 20px;">No overview data available</p>');
			return;
		}

		// Safely access properties with defaults to prevent display issues
		const safeOverview = {
			stock_entry_name: overview.stock_entry_name || 'N/A',
			stock_entry_type: overview.stock_entry_type || 'N/A',
			purpose: overview.purpose || 'N/A',
			posting_date: overview.posting_date || 'N/A',
			company: overview.company || 'N/A',
			total_items: overview.total_items || 0,
			items_with_issues: overview.items_with_issues || 0,
			expected_sles: overview.expected_sles || 0,
			actual_sles: overview.actual_sles || 0,
			total_batches: overview.total_batches || 0,
			batches_involved: overview.batches_involved || [],
			issues: overview.issues || []
		};

		let overview_html = `
			<div class="overview-section" style="padding: 20px;">
				<h5>Stock Entry Analysis</h5>
				<div class="row">
					<div class="col-md-6">
						<table class="table table-sm">
							<tr><td><strong>Stock Entry:</strong></td><td>${safeOverview.stock_entry_name}</td></tr>
							<tr><td><strong>Type:</strong></td><td>${safeOverview.stock_entry_type}</td></tr>
							<tr><td><strong>Purpose:</strong></td><td>${safeOverview.purpose}</td></tr>
							<tr><td><strong>Posting Date:</strong></td><td>${safeOverview.posting_date}</td></tr>
							<tr><td><strong>Company:</strong></td><td>${safeOverview.company}</td></tr>
						</table>
					</div>
					<div class="col-md-6">
						<table class="table table-sm">
							<tr><td><strong>Total Items:</strong></td><td>${safeOverview.total_items}</td></tr>
							<tr><td><strong>Items with Issues:</strong></td><td class="text-danger">${safeOverview.items_with_issues}</td></tr>
							<tr><td><strong>Expected SLEs:</strong></td><td>${safeOverview.expected_sles}</td></tr>
							<tr><td><strong>Actual SLEs:</strong></td><td>${safeOverview.actual_sles}</td></tr>
							<tr><td><strong>Items in Entry:</strong></td><td>${safeOverview.total_batches}</td></tr>
						</table>
					</div>
				</div>
				
				${safeOverview.batches_involved.length > 0 ? `
					<h6>Item Details from Stock Entry:</h6>
					<div class="table-responsive">
						<table class="table table-sm table-striped">
							<thead>
								<tr>
									<th>Item Code</th>
									<th>Batch No</th>
									<th>Quantity</th>
									<th>Source Warehouse</th>
									<th>Target Warehouse</th>
								</tr>
							</thead>
							<tbody>
								${safeOverview.batches_involved.map(batch => `
									<tr>
										<td><strong>${batch.item_code || 'N/A'}</strong></td>
										<td><span class="${(batch.batch_no === 'No Batch' || !batch.batch_no) ? 'text-muted' : 'badge badge-info'}">${batch.batch_no || 'No Batch'}</span></td>
										<td>${batch.qty ? frappe.format(batch.qty, {fieldtype: 'Float', precision: 2}) : '0.00'}</td>
										<td>${batch.s_warehouse || '<span class="text-muted">-</span>'}</td>
										<td>${batch.t_warehouse || '<span class="text-muted">-</span>'}</td>
									</tr>
								`).join('')}
							</tbody>
						</table>
					</div>
				` : ''}
				
				${safeOverview.issues.length > 0 ? `
					<h6>Identified Issues:</h6>
					<div class="issues-list">
						${safeOverview.issues.map(issue => `
							<div class="alert alert-${issue.severity === 'Critical' ? 'danger' : issue.severity === 'High' ? 'warning' : 'info'}" style="margin-bottom: 10px;">
								<strong>${issue.type || 'Issue'}:</strong> ${issue.description || 'No description'}
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
										<small>${entry.voucher_type || 'N/A'}</small><br>
										<strong>${entry.voucher_no || 'N/A'}</strong>
									</td>
									<td>${entry.item_code || 'N/A'}</td>
									<td>${entry.warehouse || 'N/A'}</td>
									<td>${entry.batch_no ? `<span class="badge badge-info">${entry.batch_no}</span>` : '<span class="text-muted">No Batch</span>'}</td>
									<td class="${entry.actual_qty < 0 ? 'text-danger' : 'text-success'}">
										${entry.actual_qty ? frappe.format(entry.actual_qty, {fieldtype: 'Float', precision: 2}) : '0.00'}
									</td>
									<td class="${entry.qty_after_transaction < 0 ? 'text-danger' : ''}">
										${entry.qty_after_transaction ? frappe.format(entry.qty_after_transaction, {fieldtype: 'Float', precision: 2}) : '0.00'}
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
		console.log('Rendering item details:', items); // Debug log
		
		if (!items || !items.length) {
			$('#items-content').html(`
				<div style="padding: 20px; text-align: center;">
					<p class="text-muted">No item analysis details available.</p>
					<small class="text-muted">This might happen if the items don't have stock ledger entries in the specified warehouse filter.</small>
				</div>
			`);
			return;
		}

		let items_html = `
			<div class="items-section" style="padding: 20px;">
				<h5>Item Analysis Details</h5>
				<p class="text-muted">Detailed analysis for each item in the stock entry:</p>
				${items.map(item => `
					<div class="item-card" style="margin-bottom: 20px; padding: 15px; border: 1px solid #dee2e6; border-radius: 6px;">
						<h6>${item.item_code} ${item.analyzed_warehouse ? `<small class="text-muted">(${item.analyzed_warehouse})</small>` : ''} ${item.current_balance < 0 ? '<span class="badge badge-danger">Negative Stock</span>' : '<span class="badge badge-success">Positive Stock</span>'}</h6>
						
						<div class="row">
							<div class="col-md-6">
								<table class="table table-sm">
									<tr><td><strong>Current Balance:</strong></td><td class="${item.current_balance < 0 ? 'text-danger' : item.current_balance > 0 ? 'text-success' : 'text-warning'}">${frappe.format(item.current_balance, {fieldtype: 'Float', precision: 2})}</td></tr>
									<tr><td><strong>Primary Warehouse:</strong></td><td>${item.primary_warehouse || 'Not Specified'}</td></tr>
									<tr><td><strong>Primary Batch:</strong></td><td>${item.primary_batch || 'No Batch/Multiple'}</td></tr>
								</table>
							</div>
							<div class="col-md-6">
								<table class="table table-sm">
									<tr><td><strong>First Negative Date:</strong></td><td>${item.first_negative_date ? frappe.datetime.str_to_user(item.first_negative_date) : 'Never'}</td></tr>
									<tr><td><strong>Total Entries:</strong></td><td>${item.total_entries || 0}</td></tr>
									<tr><td><strong>Last Transaction:</strong></td><td>${item.last_transaction_date ? frappe.datetime.str_to_user(item.last_transaction_date) : 'No transactions'}</td></tr>
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
			$('#negative-items-content').html('<p class="text-muted" style="padding: 20px;">No items with negative stock found</p>');
			// Automatically switch to negative items tab
			this.tabs_area.find('a[role="tab"]').removeClass('active');
			this.tabs_area.find('.tab-pane').removeClass('show active');
			$('#negative-items-tab').addClass('active');
			$('#negative-items').addClass('show active');
			return;
		}

		// Show filter information
		let filter_info = '';
		if (filter_applied.warehouse || filter_applied.stock_entry_type || filter_applied.item_code) {
			let filters = [];
			if (filter_applied.warehouse) filters.push(`Warehouse: ${filter_applied.warehouse}`);
			if (filter_applied.stock_entry_type) filters.push(`Stock Entry Type: ${filter_applied.stock_entry_type}`);
			if (filter_applied.item_code) filters.push(`Item Code: ${filter_applied.item_code}`);
			
			filter_info = `
				<div class="alert alert-info">
					<strong>Filters Applied:</strong> ${filters.join(', ')}
				</div>
			`;
		}

		// Create content for the negative items tab
		let negative_items_content = `
			<div class="negative-items-section" style="padding: 20px;">
				<div class="d-flex justify-content-between align-items-center mb-3">
					<h5>Items with Negative Stock (${items.length} items)</h5>
					<button class="btn btn-sm btn-success" id="bulk-fix-btn">
						<i class="fa fa-wrench"></i> Fix Selected Items
					</button>
				</div>
				${filter_info}
				<div class="table-responsive">
					<table class="table table-striped table-hover">
						<thead class="thead-light">
							<tr>
								<th width="40px">
									<input type="checkbox" id="select-all-items" title="Select All">
								</th>
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
							${items.map((item, index) => `
								<tr>
									<td>
										<input type="checkbox" class="item-checkbox" 
											data-item="${item.item_code}" 
											data-warehouse="${item.warehouse}"
											data-balance="${item.current_balance}">
									</td>
									<td><strong>${item.item_code}</strong></td>
									<td>${item.warehouse}</td>
									<td class="text-danger">
										<strong>${frappe.format(item.current_balance, {fieldtype: 'Float', precision: 2})}</strong>
										${item.batch_breakdown && item.batch_breakdown.length > 0 ? `
											<br><small class="text-muted">
												<i class="fa fa-info-circle"></i> 
												<a href="#" class="batch-breakdown-link" data-index="${index}">
													${item.batch_breakdown.length} batch(es) with negative stock
												</a>
											</small>
										` : ''}
									</td>
									<td>${item.first_negative_date || 'N/A'}</td>
									<td><span class="badge badge-secondary">${item.total_entries}</span></td>
									${filter_applied.stock_entry_type ? `<td class="text-info">${item.filtered_type_entries || 0}</td>` : ''}
									<td><small class="text-muted">${item.related_entry_types || 'N/A'}</small></td>
									<td>
										<div class="btn-group">
											<button class="btn btn-sm btn-primary analyze-item-btn" 
												data-item="${item.item_code}" 
												data-warehouse="${item.warehouse}"
												title="Analyze This Item">
												<i class="fa fa-search"></i> Analyze
											</button>
											<button class="btn btn-sm btn-warning fix-item-btn" 
												data-item="${item.item_code}" 
												data-warehouse="${item.warehouse}"
												data-balance="${item.current_balance}"
												title="Fix This Item">
												<i class="fa fa-wrench"></i> Fix
											</button>
										</div>
									</td>
								</tr>
								${item.batch_breakdown && item.batch_breakdown.length > 0 ? `
									<tr class="batch-breakdown-row" id="batch-breakdown-${index}" style="display: none;">
										<td colspan="${filter_applied.stock_entry_type ? '9' : '8'}">
											<div class="batch-breakdown-container" style="background: #f8f9fa; padding: 15px; margin: 5px 0;">
												<h6><i class="fa fa-tags"></i> Batch-wise Breakdown for ${item.item_code}</h6>
												<div class="table-responsive">
													<table class="table table-sm table-striped">
														<thead>
															<tr>
																<th>Batch No</th>
																<th>Negative Balance</th>
																<th>Entries Count</th>
																<th>First Transaction</th>
																<th>Last Transaction</th>
																<th>Actions</th>
															</tr>
														</thead>
														<tbody>
															${item.batch_breakdown.map(batch => `
																<tr>
																	<td><span class="badge badge-info">${batch.batch_no}</span></td>
																	<td class="text-danger"><strong>${frappe.format(batch.batch_balance, {fieldtype: 'Float', precision: 2})}</strong></td>
																	<td>${batch.entries_count}</td>
																	<td>${batch.first_transaction ? frappe.datetime.str_to_user(batch.first_transaction) : 'N/A'}</td>
																	<td>${batch.last_transaction ? frappe.datetime.str_to_user(batch.last_transaction) : 'N/A'}</td>
																	<td>
																		<button class="btn btn-xs btn-warning fix-batch-btn" 
																			data-item="${item.item_code}" 
																			data-warehouse="${item.warehouse}"
																			data-batch="${batch.batch_no}"
																			data-balance="${batch.batch_balance}"
																			title="Fix This Batch">
																			<i class="fa fa-wrench"></i> Fix Batch
																		</button>
																	</td>
																</tr>
															`).join('')}
														</tbody>
													</table>
												</div>
												<div class="mt-2">
													<small class="text-muted">
														<i class="fa fa-info-circle"></i> 
														You can fix individual batches or fix the entire item. Fixing the entire item will distribute the correction across all negative batches.
													</small>
												</div>
											</div>
										</td>
									</tr>
								` : ''}
							`).join('')}
						</tbody>
					</table>
				</div>
				
				<div class="mt-3">
					<small class="text-muted">
						<i class="fa fa-info-circle"></i> 
						Select items and click "Fix Selected Items" for bulk operations, or use individual "Fix" buttons for single items.
					</small>
				</div>
			</div>
		`;

		// Display in the negative items tab
		$('#negative-items-content').html(negative_items_content);
		
		// Automatically switch to negative items tab
		this.tabs_area.find('a[role="tab"]').removeClass('active');
		this.tabs_area.find('.tab-pane').removeClass('show active');
		$('#negative-items-tab').addClass('active');
		$('#negative-items').addClass('show active');

		// Bind events for the negative items
		this.bind_negative_items_events();
	}

	bind_negative_items_events() {
		let me = this;
		
		// Select all checkbox
		$(document).off('change', '#select-all-items').on('change', '#select-all-items', function() {
			$('.item-checkbox').prop('checked', $(this).prop('checked'));
		});

		// Batch breakdown toggle
		$(document).off('click', '.batch-breakdown-link').on('click', '.batch-breakdown-link', function(e) {
			e.preventDefault();
			let index = $(this).data('index');
			let breakdownRow = $(`#batch-breakdown-${index}`);
			
			if (breakdownRow.is(':visible')) {
				breakdownRow.hide();
				$(this).html($(this).html().replace('Hide', 'Show'));
			} else {
				breakdownRow.show();
				$(this).html($(this).html().replace('Show', 'Hide'));
			}
		});

		// Individual analyze button
		$(document).off('click', '.analyze-item-btn').on('click', '.analyze-item-btn', function(e) {
			e.preventDefault();
			let item_code = $(this).data('item');
			let warehouse = $(this).data('warehouse');
			
			me.item_code.set_value(item_code);
			me.warehouse.set_value(warehouse);
			me.analyze_item_directly();
		});

		// Individual fix button
		$(document).off('click', '.fix-item-btn').on('click', '.fix-item-btn', function(e) {
			e.preventDefault();
			let item_code = $(this).data('item');
			let warehouse = $(this).data('warehouse');
			let balance = $(this).data('balance');
			
			me.fix_single_item(item_code, warehouse, balance);
		});

		// Batch-specific fix button
		$(document).off('click', '.fix-batch-btn').on('click', '.fix-batch-btn', function(e) {
			e.preventDefault();
			let item_code = $(this).data('item');
			let warehouse = $(this).data('warehouse');
			let batch_no = $(this).data('batch');
			let balance = $(this).data('balance');
			
			me.fix_single_batch(item_code, warehouse, batch_no, balance);
		});

		// Bulk fix button
		$(document).off('click', '#bulk-fix-btn').on('click', '#bulk-fix-btn', function(e) {
			e.preventDefault();
			me.fix_selected_items();
		});
	}

	fix_single_item(item_code, warehouse, balance) {
		let me = this;
		
		// Create a dialog for fix options
		let fix_dialog = new frappe.ui.Dialog({
			title: `Fix Negative Stock: ${item_code}`,
			fields: [
				{
					fieldtype: 'HTML',
					fieldname: 'item_info',
					options: `
						<div class="alert alert-warning">
							<strong>Item:</strong> ${item_code}<br>
							<strong>Warehouse:</strong> ${warehouse}<br>
							<strong>Current Balance:</strong> <span class="text-danger">${balance}</span>
						</div>
					`
				},
				{
					fieldtype: 'Select',
					fieldname: 'fix_method',
					label: 'Fix Method',
					options: [
						{label: 'Stock Reconciliation (Recommended)', value: 'stock_reconciliation'}
					],
					default: 'stock_reconciliation',
					description: 'Stock Reconciliation will set the quantity to zero and create proper stock ledger entries'
				},
				{
					fieldtype: 'Float',
					fieldname: 'target_qty',
					label: 'Target Quantity',
					default: 0,
					description: 'Set the target quantity after fixing (usually 0 to clear negative stock)'
				},
				{
					fieldtype: 'Date',
					fieldname: 'posting_date',
					label: 'Posting Date',
					default: frappe.datetime.get_today(),
					description: 'Date for the correction entry'
				},
				{
					fieldtype: 'Check',
					fieldname: 'confirm_fix',
					label: 'I understand this will create a Stock Reconciliation entry',
					default: 0
				}
			],
			primary_action_label: 'Fix Item',
			primary_action: function(values) {
				if (!values.confirm_fix) {
					frappe.msgprint('Please confirm that you understand the fix process');
					return;
				}
				
				me.execute_single_fix(item_code, warehouse, balance, values);
				fix_dialog.hide();
			},
			secondary_action_label: 'Cancel'
		});
		
		fix_dialog.show();
	}

	async execute_single_fix(item_code, warehouse, current_balance, fix_options) {
		frappe.show_progress('Fixing negative stock...', 50, 100);
		
		try {
			let response = await frappe.call({
				method: 'stock_ledger_fixer.stock_ledger_fixer.page.stock_negative_history_analyzer.stock_negative_history_analyzer.fix_negative_stock_item',
				args: {
					item_code: item_code,
					warehouse: warehouse,
					current_balance: current_balance,
					fix_method: fix_options.fix_method,
					posting_date: fix_options.posting_date
				}
			});

			if (response.message.status === 'success') {
				frappe.show_alert({
					message: `✅ Successfully fixed ${item_code}! Document: ${response.message.document}`,
					indicator: 'green'
				});
				
				// Refresh the negative items list if the user is on the negative items tab
				if ($('#negative-items-tab').hasClass('active')) {
					this.find_negative_stock_items();
				}
			} else {
				frappe.msgprint({
					title: 'Fix Failed',
					message: response.message.message || 'Failed to fix negative stock',
					indicator: 'red'
				});
			}
		} catch (error) {
			console.error('Error fixing item:', error);
			frappe.msgprint({
				title: 'Error',
				message: 'Failed to fix negative stock. Please check console for details.',
				indicator: 'red'
			});
		} finally {
			frappe.hide_progress();
		}
	}

	fix_single_batch(item_code, warehouse, batch_no, balance) {
		let me = this;
		
		// Create a dialog for batch-specific fix options
		let fix_dialog = new frappe.ui.Dialog({
			title: `Fix Negative Stock: ${item_code} - Batch ${batch_no}`,
			fields: [
				{
					fieldtype: 'HTML',
					fieldname: 'batch_info',
					options: `
						<div class="alert alert-warning">
							<strong>Item:</strong> ${item_code}<br>
							<strong>Warehouse:</strong> ${warehouse}<br>
							<strong>Batch:</strong> ${batch_no}<br>
							<strong>Current Balance:</strong> <span class="text-danger">${balance}</span>
						</div>
					`
				},
				{
					fieldtype: 'Select',
					fieldname: 'fix_method',
					label: 'Fix Method',
					options: [
						{label: 'Stock Reconciliation (Recommended)', value: 'stock_reconciliation'}
					],
					default: 'stock_reconciliation',
					reqd: 1
				},
				{
					fieldtype: 'Date',
					fieldname: 'posting_date',
					label: 'Posting Date',
					default: frappe.datetime.get_today(),
					reqd: 1
				},
				{
					fieldtype: 'HTML',
					fieldname: 'fix_info',
					options: `
						<div class="alert alert-info">
							<strong>Note:</strong> This will create a Stock Reconciliation to set this batch's balance to zero, effectively clearing the negative stock for this specific batch.
						</div>
					`
				}
			],
			primary_action_label: 'Fix Batch',
			primary_action: async function(values) {
				fix_dialog.hide();
				await me.execute_batch_fix(item_code, warehouse, batch_no, balance, values);
			}
		});
		
		fix_dialog.show();
	}

	async execute_batch_fix(item_code, warehouse, batch_no, current_balance, fix_options) {
		frappe.show_progress('Fixing Batch...', 50, 100);
		
		try {
			let response = await frappe.call({
				method: 'stock_ledger_fixer.stock_ledger_fixer.page.stock_negative_history_analyzer.stock_negative_history_analyzer.fix_negative_stock_batch',
				args: {
					item_code: item_code,
					warehouse: warehouse,
					batch_no: batch_no,
					current_balance: current_balance,
					fix_method: fix_options.fix_method,
					posting_date: fix_options.posting_date
				}
			});

			if (response.message.status === 'success') {
				frappe.show_alert({
					message: `✅ Successfully fixed batch ${batch_no}! Document: ${response.message.document}`,
					indicator: 'green'
				});
				
				// Refresh the negative items list if the user is on the negative items tab
				if ($('#negative-items-tab').hasClass('active')) {
					this.find_negative_stock_items();
				}
			} else {
				frappe.msgprint({
					title: 'Batch Fix Failed',
					message: response.message.message || 'Failed to fix negative stock for batch',
					indicator: 'red'
				});
			}
		} catch (error) {
			console.error('Error fixing batch:', error);
			frappe.msgprint('Failed to fix negative stock for batch. Please try again.');
		} finally {
			frappe.hide_progress();
		}
	}

	// ...existing code...
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
