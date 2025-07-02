frappe.pages['stock-entry-issues-detector'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Stock Entry Issues Detector',
		single_column: true
	});

	frappe.stock_entry_issues_detector = new StockEntryIssuesDetector(page);
}

class StockEntryIssuesDetector {
	constructor(page) {
		this.page = page;
		this.make_filters();
		this.make_results_area();
		this.bind_events();
		this.load_default_data();
	}

	make_filters() {
		let me = this;
		
		// Date filters
		this.from_date = this.page.add_field({
			label: 'From Date',
			fieldtype: 'Date',
			fieldname: 'from_date',
			default: frappe.datetime.add_days(frappe.datetime.now_date(), -30),
			change: () => this.refresh_data()
		});

		this.to_date = this.page.add_field({
			label: 'To Date',
			fieldtype: 'Date',
			fieldname: 'to_date',
			default: frappe.datetime.now_date(),
			change: () => this.refresh_data()
		});

		// Stock entry type filter
		this.stock_entry_type = this.page.add_field({
			label: 'Stock Entry Type',
			fieldtype: 'Select',
			fieldname: 'stock_entry_type',
			options: [
				{ label: 'All', value: 'All' },
				{ label: 'Material Transfer', value: 'Material Transfer' },
				{ label: 'Material Transfer for Manufacture', value: 'Material Transfer for Manufacture' },
				{ label: 'Repack', value: 'Repack' },
				{ label: 'Manufacture', value: 'Manufacture' }
			],
			default: 'All',
			change: () => this.refresh_data()
		});

		// Limit filter
		this.limit = this.page.add_field({
			label: 'Limit',
			fieldtype: 'Int',
			fieldname: 'limit',
			default: 100,
			change: () => this.refresh_data()
		});

		// Action buttons
		this.page.add_inner_button('Refresh', () => this.refresh_data());
		this.page.add_inner_button('Export', () => this.export_data());
		this.page.add_inner_button('Fix Selected', () => this.fix_selected_entries());
	}

	make_results_area() {
		// Summary section
		this.summary_area = $(`
			<div class="summary-section" style="margin: 20px 0; padding: 15px; background: #f8f9fa; border-radius: 6px;">
				<h4>Summary</h4>
				<div class="row summary-stats">
					<div class="col-md-3">
						<div class="stat-card">
							<div class="stat-number" id="total-entries">-</div>
							<div class="stat-label">Total Entries</div>
						</div>
					</div>
					<div class="col-md-3">
						<div class="stat-card">
							<div class="stat-number text-danger" id="affected-entries">-</div>
							<div class="stat-label">Affected Entries</div>
						</div>
					</div>
					<div class="col-md-3">
						<div class="stat-card">
							<div class="stat-number text-warning" id="missing-sles">-</div>
							<div class="stat-label">Missing SLEs</div>
						</div>
					</div>
					<div class="col-md-3">
						<div class="stat-card">
							<div class="stat-number text-info" id="success-rate">-</div>
							<div class="stat-label">Success Rate</div>
						</div>
					</div>
				</div>
			</div>
		`).appendTo(this.page.main);

		// Results table
		this.results_area = $(`
			<div class="results-section">
				<div class="table-responsive">
					<table class="table table-striped" id="results-table">
						<thead>
							<tr>
								<th><input type="checkbox" id="select-all"></th>
								<th>Stock Entry</th>
								<th>Date</th>
								<th>Type</th>
								<th>Details Count</th>
								<th>SLE Count</th>
								<th>Missing SLEs</th>
								<th>Value (Out/In)</th>
								<th>Actions</th>
							</tr>
						</thead>
						<tbody id="results-tbody">
						</tbody>
					</table>
				</div>
			</div>
		`).appendTo(this.page.main);

		// Details modal placeholder
		this.details_modal = null;
	}

	bind_events() {
		let me = this;

		// Select all checkbox
		$(document).on('change', '#select-all', function() {
			$('.entry-checkbox').prop('checked', this.checked);
		});

		// Row click to show details
		$(document).on('click', '.stock-entry-link', function(e) {
			e.preventDefault();
			let stock_entry = $(this).data('stock-entry');
			me.show_stock_entry_details(stock_entry);
		});

		// Fix single entry
		$(document).on('click', '.fix-entry-btn', function() {
			let stock_entry = $(this).data('stock-entry');
			me.fix_single_entry(stock_entry);
		});

		// Diagnose single entry
		$(document).on('click', '.diagnose-entry-btn', function() {
			let stock_entry = $(this).data('stock-entry');
			me.diagnose_single_entry(stock_entry);
		});
	}

	async load_default_data() {
		this.refresh_data();
	}

	async refresh_data() {
		frappe.show_progress('Loading...', 30, 100);
		
		try {
			let filters = this.get_filters();
			let response = await frappe.call({
				method: 'stock_ledger_fixer.stock_ledger_fixer.page.stock_entry_issues_detector.stock_entry_issues_detector.get_stock_entries_with_missing_sles',
				args: filters
			});

			frappe.show_progress('Loading...', 70, 100);

			if (response.message.status === 'success') {
				this.render_summary(response.message.summary);
				this.render_results(response.message.data);
			} else {
				frappe.msgprint({
					title: 'Error',
					indicator: 'red',
					message: response.message.message || 'Failed to fetch data'
				});
			}
		} catch (error) {
			console.error('Error fetching data:', error);
			frappe.msgprint({
				title: 'Error',
				indicator: 'red',
				message: 'Failed to fetch data. Please check console for details.'
			});
		} finally {
			frappe.hide_progress();
		}
	}

	get_filters() {
		return {
			from_date: this.from_date.get_value(),
			to_date: this.to_date.get_value(),
			stock_entry_type: this.stock_entry_type.get_value(),
			limit: this.limit.get_value() || 100
		};
	}

	render_summary(summary) {
		if (!summary) return;

		$('#total-entries').text(summary.total_entries || 0);
		$('#affected-entries').text(summary.affected_entries || 0);
		$('#missing-sles').text(summary.total_missing_sles || 0);
		
		let success_rate = summary.total_entries > 0 ? 
			(((summary.total_entries - summary.affected_entries) / summary.total_entries) * 100).toFixed(1) + '%' : '0%';
		$('#success-rate').text(success_rate);
	}

	render_results(data) {
		let tbody = $('#results-tbody');
		tbody.empty();

		if (!data || data.length === 0) {
			tbody.append(`
				<tr>
					<td colspan="9" class="text-center text-muted">No affected stock entries found</td>
				</tr>
			`);
			return;
		}

		data.forEach(row => {
			let row_html = `
				<tr>
					<td><input type="checkbox" class="entry-checkbox" value="${row.name}"></td>
					<td>
						<a href="#" class="stock-entry-link" data-stock-entry="${row.name}">
							${row.name}
						</a>
					</td>
					<td>${frappe.datetime.str_to_user(row.creation)}</td>
					<td><span class="badge badge-light">${row.stock_entry_type}</span></td>
					<td>${row.details_count}</td>
					<td>${row.sle_count}</td>
					<td><span class="badge badge-danger">${row.missing_sles}</span></td>
					<td>
						${frappe.format(row.total_outgoing_value || 0, {fieldtype: 'Currency'})} / 
						${frappe.format(row.total_incoming_value || 0, {fieldtype: 'Currency'})}
					</td>
					<td>
						<button class="btn btn-sm btn-info diagnose-entry-btn" data-stock-entry="${row.name}" style="margin-right: 5px;">
							Diagnose
						</button>
						<button class="btn btn-sm btn-primary fix-entry-btn" data-stock-entry="${row.name}">
							Fix
						</button>
					</td>
				</tr>
			`;
			tbody.append(row_html);
		});
	}

	async show_stock_entry_details(stock_entry_name) {
		let me = this;
		
		frappe.show_progress('Loading details...', 50, 100);
		
		try {
			let response = await frappe.call({
				method: 'stock_ledger_fixer.stock_ledger_fixer.page.stock_entry_issues_detector.stock_entry_issues_detector.get_stock_entry_details',
				args: { stock_entry_name: stock_entry_name }
			});

			if (response.message.status === 'success') {
				this.render_details_modal(response.message);
			} else {
				frappe.msgprint('Failed to fetch stock entry details');
			}
		} catch (error) {
			console.error('Error fetching details:', error);
			frappe.msgprint('Failed to fetch stock entry details');
		} finally {
			frappe.hide_progress();
		}
	}

	render_details_modal(data) {
		let se = data.stock_entry;
		let items = data.items;
		let error_logs = data.error_logs;

		// Build items table
		let items_html = items.map(item => `
			<tr class="${item.sle_status === 'Missing' ? 'table-danger' : ''}">
				<td>${item.idx}</td>
				<td>${item.item_code}</td>
				<td>${item.s_warehouse || '-'}</td>
				<td>${item.t_warehouse || '-'}</td>
				<td>${item.qty}</td>
				<td>${item.batch_no || '-'}</td>
				<td>
					<span class="badge badge-${item.sle_status === 'Missing' ? 'danger' : 'success'}">
						${item.sle_status}
					</span>
				</td>
			</tr>
		`).join('');

		// Build error logs
		let error_logs_html = error_logs && error_logs.length > 0 ? 
			error_logs.map(log => `
				<div class="error-log-item" style="margin-bottom: 10px; padding: 10px; background: #fee; border-left: 3px solid #dc3545;">
					<strong>${log.method}</strong> at ${frappe.datetime.str_to_user(log.creation)}<br>
					<small>${log.error.substring(0, 200)}...</small>
				</div>
			`).join('') : '<p class="text-muted">No related error logs found</p>';

		let modal_content = `
			<div class="modal fade" id="stock-entry-details-modal" tabindex="-1">
				<div class="modal-dialog modal-xl">
					<div class="modal-content">
						<div class="modal-header">
							<h5 class="modal-title">Stock Entry Details: ${se.name}</h5>
							<button type="button" class="close" data-dismiss="modal">&times;</button>
						</div>
						<div class="modal-body">
							<div class="row">
								<div class="col-md-6">
									<h6>Basic Information</h6>
									<table class="table table-sm">
										<tr><td><strong>Type:</strong></td><td>${se.stock_entry_type}</td></tr>
										<tr><td><strong>Purpose:</strong></td><td>${se.purpose}</td></tr>
										<tr><td><strong>Date:</strong></td><td>${frappe.datetime.str_to_user(se.posting_date)}</td></tr>
										<tr><td><strong>Company:</strong></td><td>${se.company}</td></tr>
									</table>
								</div>
								<div class="col-md-6">
									<h6>Summary</h6>
									<table class="table table-sm">
										<tr><td><strong>Total Items:</strong></td><td>${data.total_count}</td></tr>
										<tr><td><strong>Missing SLEs:</strong></td><td class="text-danger">${data.missing_count}</td></tr>
										<tr><td><strong>Outgoing Value:</strong></td><td>${frappe.format(se.total_outgoing_value, {fieldtype: 'Currency'})}</td></tr>
										<tr><td><strong>Incoming Value:</strong></td><td>${frappe.format(se.total_incoming_value, {fieldtype: 'Currency'})}</td></tr>
									</table>
								</div>
							</div>
							
							<h6>Items Details</h6>
							<div class="table-responsive">
								<table class="table table-sm table-striped">
									<thead>
										<tr>
											<th>#</th>
											<th>Item Code</th>
											<th>From Warehouse</th>
											<th>To Warehouse</th>
											<th>Qty</th>
											<th>Batch</th>
											<th>SLE Status</th>
										</tr>
									</thead>
									<tbody>
										${items_html}
									</tbody>
								</table>
							</div>

							<h6>Related Error Logs</h6>
							<div style="max-height: 300px; overflow-y: auto;">
								${error_logs_html}
							</div>
						</div>
						<div class="modal-footer">
							<button type="button" class="btn btn-secondary" data-dismiss="modal">Close</button>
							<button type="button" class="btn btn-primary" onclick="frappe.stock_entry_issues_detector.fix_single_entry('${se.name}')">
								Fix Missing SLEs
							</button>
						</div>
					</div>
				</div>
			</div>
		`;

		// Remove existing modal and add new one
		$('#stock-entry-details-modal').remove();
		$('body').append(modal_content);
		$('#stock-entry-details-modal').modal('show');
	}

	async diagnose_single_entry(stock_entry_name) {
		let me = this;
		
		frappe.show_progress('Diagnosing...', 50, 100);
		
		try {
			let response = await frappe.call({
				method: 'stock_ledger_fixer.stock_ledger_fixer.page.stock_entry_issues_detector.stock_entry_issues_detector.diagnose_stock_entry_issues',
				args: { stock_entry_name: stock_entry_name }
			});

			if (response.message.status === 'success') {
				this.show_diagnosis_modal(response.message);
			} else {
				frappe.msgprint('Failed to diagnose stock entry');
			}
		} catch (error) {
			console.error('Error diagnosing entry:', error);
			frappe.msgprint('Failed to diagnose stock entry');
		} finally {
			frappe.hide_progress();
		}
	}

	show_diagnosis_modal(diagnosis_data) {
		let issues = diagnosis_data.issues || [];
		
		// Build issues list
		let issues_html = issues.length > 0 ? 
			issues.map(issue => {
				let severity_color = issue.severity === 'Critical' ? 'danger' : 
									issue.severity === 'High' ? 'danger' : 
									issue.severity === 'Medium' ? 'warning' : 'info';
				let details_html = '';
				
				if (issue.details) {
					// Special formatting for different issue types
					if (issue.type === 'Deadlock Evidence') {
						details_html = `
							<div style="margin-top: 10px; padding: 10px; background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 4px;">
								<strong>🔍 Deadlock Timeline:</strong>
								<div style="margin-top: 10px;">
									${issue.details.map(error => `
										<div style="margin-bottom: 10px; padding: 8px; background: #fff; border-left: 3px solid #dc3545; font-family: monospace; font-size: 11px;">
											<div style="color: #dc3545; font-weight: bold;">⚠️ ${error.time}</div>
											<div style="color: #6c757d; margin: 2px 0;"><strong>Method:</strong> ${error.method}</div>
											<div style="color: #495057; white-space: pre-wrap;">${error.error_preview}</div>
										</div>
									`).join('')}
								</div>
								${issue.time_window ? `<small class="text-muted"><strong>Search Window:</strong> ${issue.time_window}</small>` : ''}
							</div>
						`;
					} else if (issue.type === 'Bundle Type Mismatch') {
						details_html = `
							<div style="margin-top: 10px; padding: 10px; background: #f8f9fa; border-radius: 4px;">
								<strong>📦 Bundle Issues:</strong>
								<div style="margin-top: 10px;">
									${issue.details.map(bundle => `
										<div style="margin-bottom: 8px; padding: 8px; background: #fff; border-left: 3px solid #ffc107;">
											<div><strong>Bundle:</strong> ${bundle.bundle}</div>
											<div><strong>Item:</strong> ${bundle.item} (Qty: ${bundle.qty})</div>
											<div><strong>Warehouses:</strong> ${bundle.s_warehouse || 'None'} → ${bundle.t_warehouse || 'None'}</div>
											<div><strong>Type:</strong> <span style="color: #dc3545;">${bundle.current_type}</span> → <span style="color: #28a745;">${bundle.expected_type}</span></div>
										</div>
									`).join('')}
								</div>
							</div>
						`;
					} else if (issue.type === 'Insufficient Stock') {
						details_html = `
							<div style="margin-top: 10px; padding: 10px; background: #f8f9fa; border-radius: 4px;">
								<strong>📉 Stock Issues:</strong>
								<div style="margin-top: 10px;">
									${issue.details.map(stock => `
										<div style="margin-bottom: 8px; padding: 8px; background: #fff; border-left: 3px solid #17a2b8;">
											<div><strong>Item:</strong> ${stock.item}</div>
											<div><strong>Warehouse:</strong> ${stock.warehouse}</div>
											<div><strong>Batch:</strong> ${stock.batch || 'No Batch'}</div>
											<div><strong>Required:</strong> ${stock.required_qty}, <strong>Available:</strong> ${stock.available_qty}</div>
										</div>
									`).join('')}
								</div>
							</div>
						`;
					} else if (issue.type === 'Deadlock Evidence') {
						details_html = `
							<div style="margin-top: 10px; padding: 10px; background: #f8f9fa; border-radius: 4px;">
								<strong>🔒 Deadlock Events (${issue.details.length}):</strong>
								<div style="margin-top: 10px; max-height: 200px; overflow-y: auto;">
									${issue.details.map(detail => `
										<div style="margin-bottom: 10px; padding: 8px; background: #fff3cd; border-left: 3px solid #ffc107; border-radius: 3px;">
											<div><strong>⏰ Time:</strong> ${detail.time}</div>
											<div><strong>🔧 Method:</strong> ${detail.method}</div>
											<div><strong>❌ Error:</strong> <code style="font-size: 11px; background: #f8f9fa; padding: 2px 4px; border-radius: 2px;">${detail.error_preview}</code></div>
										</div>
									`).join('')}
								</div>
								${issue.time_window ? `<small class="text-muted"><strong>🕐 Search Window:</strong> ${issue.time_window}</small>` : ''}
							</div>
						`;
					} else {
						// Default formatting for other issue types
						details_html = `
							<div style="margin-top: 10px; padding: 10px; background: #f8f9fa; border-radius: 4px;">
								<strong>Details:</strong>
								<pre style="font-size: 12px; margin-top: 5px;">${JSON.stringify(issue.details, null, 2)}</pre>
							</div>
						`;
					}
				}
				
				return `
					<div class="issue-item" style="margin-bottom: 15px; padding: 15px; border-left: 4px solid var(--${severity_color}); background: #f8f9fa;">
						<div class="d-flex justify-content-between align-items-start">
							<div style="width: 100%;">
								<h6 class="text-${severity_color}">
									${issue.type === 'Deadlock Evidence' ? '🔒' : 
									  issue.type === 'Bundle Type Mismatch' ? '📦' : 
									  issue.type === 'Insufficient Stock' ? '📉' : '⚠️'} ${issue.type}
									<span class="badge badge-${severity_color} ml-2">${issue.severity}</span>
								</h6>
								<p class="mb-1">${issue.description}</p>
								<small class="text-muted"><strong>Recommended Fix:</strong> ${issue.fix}</small>
							</div>
						</div>
						${details_html}
					</div>
				`;
			}).join('') : '<p class="text-success">No issues found with this stock entry!</p>';

		let modal_content = `
			<div class="modal fade" id="diagnosis-modal" tabindex="-1">
				<div class="modal-dialog modal-lg">
					<div class="modal-content">
						<div class="modal-header">
							<h5 class="modal-title">Diagnosis Report: ${diagnosis_data.stock_entry}</h5>
							<button type="button" class="close" data-dismiss="modal">&times;</button>
						</div>
						<div class="modal-body">
							<div class="row mb-3">
								<div class="col-md-4">
									<div class="stat-card text-center">
										<div class="stat-number ${diagnosis_data.issues_found > 0 ? 'text-danger' : 'text-success'}">
											${diagnosis_data.issues_found}
										</div>
										<div class="stat-label">Issues Found</div>
									</div>
								</div>
								<div class="col-md-4">
									<div class="stat-card text-center">
										<div class="stat-number ${diagnosis_data.can_auto_fix ? 'text-success' : 'text-warning'}">
											${diagnosis_data.can_auto_fix ? 'Yes' : 'No'}
										</div>
										<div class="stat-label">Can Auto-Fix</div>
									</div>
								</div>
								<div class="col-md-4">
									<div class="stat-card text-center">
										<div class="stat-number text-info">
											<i class="fa fa-stethoscope"></i>
										</div>
										<div class="stat-label">Diagnosis Complete</div>
									</div>
								</div>
							</div>
							
							<h6>Detailed Issues:</h6>
							<div style="max-height: 400px; overflow-y: auto;">
								${issues_html}
							</div>
						</div>
						<div class="modal-footer">
							<button type="button" class="btn btn-secondary" data-dismiss="modal">Close</button>
							${diagnosis_data.can_auto_fix ? `
								<button type="button" class="btn btn-success" onclick="frappe.stock_entry_issues_detector.fix_single_entry('${diagnosis_data.stock_entry}')">
									Auto-Fix Issues
								</button>
							` : ''}
						</div>
					</div>
				</div>
			</div>
		`;

		// Remove existing modal and add new one
		$('#diagnosis-modal').remove();
		$('body').append(modal_content);
		$('#diagnosis-modal').modal('show');
	}

	async fix_single_entry(stock_entry_name) {
			let me = this;
		
		// First check for negative stock issues
		try {
			let negative_analysis = await frappe.call({
				method: 'stock_ledger_fixer.stock_ledger_fixer.page.stock_entry_issues_detector.stock_entry_issues_detector.analyze_negative_stock_for_stock_entry',
				args: { stock_entry_name: stock_entry_name }
			});

			if (negative_analysis.message.status === 'success' && negative_analysis.message.negative_items.length > 0) {
				// Show negative stock analysis first
				me.show_negative_stock_analysis(stock_entry_name, negative_analysis.message);
				return;
			}
		} catch (error) {
			console.warn('Could not analyze negative stock:', error);
		}
		
		// Proceed with normal fix if no negative stock issues
		me.proceed_with_fix(stock_entry_name);
	}

	proceed_with_fix(stock_entry_name) {
		let me = this;
		
		frappe.confirm(
			`Are you sure you want to fix missing SLEs for ${stock_entry_name}?<br><br>
			<strong>Warning:</strong> This will cancel and resubmit the stock entry.`,
			async function() {
				frappe.show_progress('Fixing...', 50, 100);
				
				try {
					let response = await frappe.call({
						method: 'stock_ledger_fixer.stock_ledger_fixer.page.stock_entry_issues_detector.stock_entry_issues_detector.fix_missing_sles',
						args: { stock_entry_name: stock_entry_name }
					});

					if (response.message.status === 'success') {
						frappe.show_alert({
							message: response.message.message,
							indicator: 'green'
						});
						me.refresh_data();
						$('#stock-entry-details-modal').modal('hide');
					} else {
						frappe.msgprint({
							title: 'Fix Failed',
							indicator: 'red',
							message: response.message.message
						});
					}
				} catch (error) {
					console.error('Error fixing entry:', error);
					frappe.msgprint('Failed to fix entry. Please check console for details.');
				} finally {
					frappe.hide_progress();
				}
			}
		);
	}

	async fix_selected_entries() {
		let selected = $('.entry-checkbox:checked').map(function() {
			return this.value;
		}).get();

		if (selected.length === 0) {
			frappe.msgprint('Please select at least one entry to fix');
			return;
		}

		frappe.confirm(
			`Are you sure you want to fix ${selected.length} selected entries?<br><br>
			<strong>Warning:</strong> This will cancel and resubmit all selected stock entries.`,
			async function() {
				frappe.show_progress('Fixing entries...', 0, 100);
				
				let success_count = 0;
				let error_count = 0;
				
				for (let i = 0; i < selected.length; i++) {
					try {
						frappe.show_progress('Fixing entries...', (i / selected.length) * 100, 100);
						
						let response = await frappe.call({
							method: 'stock_ledger_fixer.stock_ledger_fixer.page.stock_entry_issues_detector.stock_entry_issues_detector.fix_missing_sles',
							args: { stock_entry_name: selected[i] }
						});

						if (response.message.status === 'success') {
							success_count++;
						} else {
							error_count++;
						}
					} catch (error) {
						error_count++;
					}
				}

				frappe.hide_progress();
				
				frappe.msgprint({
					title: 'Batch Fix Complete',
					indicator: success_count > error_count ? 'green' : 'orange',
					message: `Fixed: ${success_count}, Failed: ${error_count}`
				});

				frappe.stock_entry_issues_detector.refresh_data();
			}
		);
	}

	export_data() {
		// Get current data and convert to CSV
		let data = [];
		$('#results-tbody tr').each(function() {
			if ($(this).find('td').length > 1) {
				let row = [];
				$(this).find('td').each(function(index) {
					if (index > 0 && index < 8) { // Skip checkbox and actions columns
						row.push($(this).text().trim());
					}
				});
				data.push(row);
			}
		});

		if (data.length === 0) {
			frappe.msgprint('No data to export');
			return;
		}

		// Create CSV content
		let headers = ['Stock Entry', 'Date', 'Type', 'Details Count', 'SLE Count', 'Missing SLEs', 'Value (Out/In)'];
		let csv_content = [headers.join(',')];
		data.forEach(row => {
			csv_content.push(row.join(','));
		});

		// Download CSV
		let blob = new Blob([csv_content.join('\n')], { type: 'text/csv' });
		let url = window.URL.createObjectURL(blob);
		let a = document.createElement('a');
		a.href = url;
		a.download = `stock_entry_issues_${frappe.datetime.now_date()}.csv`;
		a.click();
		window.URL.revokeObjectURL(url);
	}

	show_negative_stock_analysis(stock_entry_name, analysis_data) {
		let me = this;
		let negative_items = analysis_data.negative_items;
		let summary = analysis_data.summary;
		
		let negative_items_html = negative_items.map(item => {
			let batch_info = item.batch_no !== "No Batch" ? `<strong>Batch:</strong> ${item.batch_no}<br>` : '';
			let status_badge = item.is_currently_negative ? 
				'<span class="badge badge-danger">Currently Negative</span>' : 
				'<span class="badge badge-warning">Will Be Negative</span>';
			
			return `
				<div class="alert alert-${item.is_currently_negative ? 'danger' : 'warning'}" style="margin-bottom: 15px;">
					<h6>${item.item_code} ${status_badge}</h6>
					<div class="row">
						<div class="col-md-6">
							${batch_info}
							<strong>Warehouse:</strong> ${item.warehouse}<br>
							<strong>Current Stock:</strong> ${frappe.format(item.current_qty, {fieldtype: 'Float', precision: 2})}<br>
							<strong>Required:</strong> ${frappe.format(item.required_qty, {fieldtype: 'Float', precision: 2})}
						</div>
						<div class="col-md-6">
							<strong>Shortage:</strong> ${frappe.format(item.shortage, {fieldtype: 'Float', precision: 2})}<br>
							<strong>Total Transactions:</strong> ${item.transaction_count}<br>
							<strong>Last Transaction:</strong> ${item.last_transaction ? frappe.datetime.str_to_user(item.last_transaction) : 'None'}
						</div>
					</div>
					
					${item.recent_transactions && item.recent_transactions.length > 0 ? `
						<h6 style="margin-top: 15px;">Recent Transactions:</h6>
						<div class="table-responsive">
							<table class="table table-sm">
								<thead>
									<tr><th>Date</th><th>Document</th><th>Qty Change</th><th>Balance After</th></tr>
								</thead>
								<tbody>
									${item.recent_transactions.slice(0, 5).map(txn => `
										<tr class="${txn.voucher_no === stock_entry_name ? 'table-info' : ''}">
											<td>${frappe.datetime.str_to_user(txn.posting_date)}</td>
											<td><small>${txn.voucher_type}</small><br>${txn.voucher_no}</td>
											<td class="${txn.actual_qty < 0 ? 'text-danger' : 'text-success'}">
												${frappe.format(txn.actual_qty, {fieldtype: 'Float', precision: 2})}
											</td>
											<td class="${txn.qty_after_transaction < 0 ? 'text-danger' : ''}">
												${frappe.format(txn.qty_after_transaction, {fieldtype: 'Float', precision: 2})}
											</td>
										</tr>
									`).join('')}
								</tbody>
							</table>
						</div>
					` : ''}
				</div>
			`;
		}).join('');

		let modal_content = `
			<div class="modal fade" id="negative-stock-analysis-modal" tabindex="-1">
				<div class="modal-dialog modal-xl">
					<div class="modal-content">
						<div class="modal-header">
							<h5 class="modal-title">⚠️ Negative Stock Issues Detected</h5>
							<button type="button" class="close" data-dismiss="modal">&times;</button>
						</div>
						<div class="modal-body">
							<div class="alert alert-warning">
								<h6>Stock Entry: ${stock_entry_name}</h6>
								<p><strong>Cannot proceed with fix due to negative stock issues.</strong></p>
								<p>The following items have negative stock that would prevent the fix from completing:</p>
								<ul>
									<li><strong>Currently Negative:</strong> ${summary.currently_negative} items</li>
									<li><strong>Will Be Negative:</strong> ${summary.will_be_negative} items</li>
									<li><strong>Total Issues:</strong> ${summary.total_negative_items} items</li>
								</ul>
							</div>
							
							<h6>Detailed Breakdown:</h6>
							${negative_items_html}
							
							<div class="alert alert-info">
								<h6>📋 Next Steps:</h6>
								<ol>
									<li><strong>Check the transactions:</strong> Items highlighted in blue are from this stock entry</li>
									<li><strong>Verify data integrity:</strong> Ensure all previous stock movements are correct</li>
									<li><strong>Fix negative stock first:</strong> Use Stock Reconciliation or correct previous entries</li>
									<li><strong>Then retry this fix:</strong> Once stock is positive, this fix can proceed</li>
								</ol>
							</div>
						</div>
						<div class="modal-footer">
							<button type="button" class="btn btn-secondary" data-dismiss="modal">Cancel</button>
							<button type="button" class="btn btn-warning" onclick="frappe.stock_entry_issues_detector.proceed_with_fix('${stock_entry_name}')">
								⚠️ Force Fix (Risk Data Issues)
							</button>
							<button type="button" class="btn btn-primary" id="create-reconciliation-btn" data-stock-entry="${stock_entry_name}">
								📊 Create Pre-filled Stock Reconciliation
							</button>
						</div>
					</div>
				</div>
			</div>
		`;

		// Remove existing modal if any
		$('#negative-stock-analysis-modal').remove();
		
		// Store negative items data for the reconciliation button
		this.current_negative_items = negative_items;
		
		// Add modal to body and show
		$('body').append(modal_content);
		$('#negative-stock-analysis-modal').modal('show');
		
		// Bind event for reconciliation button
		$('#create-reconciliation-btn').on('click', (e) => {
			let stock_entry_name = $(e.target).data('stock-entry');
			this.create_prefilled_reconciliation(stock_entry_name, this.current_negative_items);
		});
	}

	create_prefilled_reconciliation(stock_entry_name, negative_items) {
		if (!negative_items || negative_items.length === 0) {
			frappe.msgprint('No negative stock items found to reconcile.');
			return;
		}
		
		frappe.show_progress('Creating Stock Reconciliation...', 30, 100);
		
		// Close the modal first
		$('#negative-stock-analysis-modal').modal('hide');
		
		// Prepare the items data
		let items_data = [];
		negative_items.forEach((item, index) => {
			// Calculate target quantity - we want to bring negative stock to zero or positive
			let target_qty = 0; // Set to 0 to clear negative stock
			
			let reconciliation_item = {
				item_code: item.item_code,
				warehouse: item.warehouse,
				qty: target_qty, // Try 'qty' field again
				quantity: target_qty, // Also try 'quantity' field
				current_qty: Math.abs(item.current_balance), // Show absolute value for reference
			};
			
			// Handle batch information
			if (item.batch_no && item.batch_no !== "No Batch") {
				reconciliation_item.batch_no = item.batch_no;
			}
			
			// Set valuation rate if available
			if (item.valuation_rate && item.valuation_rate > 0) {
				reconciliation_item.valuation_rate = item.valuation_rate;
				reconciliation_item.amount = target_qty * item.valuation_rate;
			}
			
			items_data.push(reconciliation_item);
		});
		
		// Create remarks
		let remarks = `Stock Reconciliation to fix negative stock issues from Stock Entry: ${stock_entry_name}

IMPORTANT: Quantities below are set to 0 to clear negative stock. Adjust as needed.

Items fixed:
${negative_items.map(item => `- ${item.item_code} in ${item.warehouse}${item.batch_no && item.batch_no !== 'No Batch' ? ' (Batch: ' + item.batch_no + ')' : ''}: Current Balance ${item.current_balance} → Target: 0`).join('\n')}`;
		
		frappe.hide_progress();
		
		// Use proper document creation and opening approach
		frappe.model.with_doctype('Stock Reconciliation', () => {
			// Create new document using the model
			let sr_doc = frappe.model.get_new_doc('Stock Reconciliation');
			
			// Set basic document properties
			sr_doc.purpose = 'Stock Reconciliation';
			sr_doc.posting_date = frappe.datetime.get_today();
			sr_doc.set_posting_time = 0;
			sr_doc.remarks = remarks;
			
			// Add items to the document
			items_data.forEach((item_data, index) => {
				let row = frappe.model.add_child(sr_doc, 'Stock Reconciliation Item', 'items');
				
				// Set specific fields directly
				row.item_code = item_data.item_code;
				row.warehouse = item_data.warehouse;
				row.qty = 0; // Force set to 0
				row.quantity = 0; // Also try quantity field
				
				if (item_data.batch_no) {
					row.batch_no = item_data.batch_no;
				}
				
				if (item_data.valuation_rate) {
					row.valuation_rate = item_data.valuation_rate;
					row.amount = 0; // 0 qty * valuation_rate = 0
				}
				
				console.log(`Row ${index + 1} set:`, {
					item_code: row.item_code,
					warehouse: row.warehouse,
					qty: row.qty,
					quantity: row.quantity,
					batch_no: row.batch_no
				});
			});
			
			// Open the form with the pre-filled document
			frappe.set_route('Form', 'Stock Reconciliation', sr_doc.name);
			
			setTimeout(() => {
				frappe.show_alert({
					message: `📊 Stock Reconciliation created with ${negative_items.length} negative stock items. Please review and submit.`,
					indicator: 'blue'
				});
			}, 500);
		});
	}
}
