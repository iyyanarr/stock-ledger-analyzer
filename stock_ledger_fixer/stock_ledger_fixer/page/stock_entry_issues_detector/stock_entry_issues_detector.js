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
}
