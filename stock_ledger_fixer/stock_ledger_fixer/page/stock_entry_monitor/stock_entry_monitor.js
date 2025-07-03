class StockEntryMonitor {
	constructor(page) {
		this.page = page;
		this.auto_refresh_interval = null;
		this.make_layout();
		this.bind_events();
		this.load_issues();
		this.setup_realtime_updates();
		this.start_auto_refresh();
	}

	make_layout() {
		// Control buttons
		this.page.add_inner_button('Refresh', () => this.load_issues());
		this.page.add_inner_button('View All Error Logs', () => frappe.set_route('List', 'Error Log'));
		this.page.add_inner_button('Clear Resolved', () => this.clear_resolved_issues());

		// Filter controls
		this.status_filter = this.page.add_field({
			label: 'Status',
			fieldtype: 'Select',
			fieldname: 'status_filter',
			options: 'Open\nResolved\nAll',
			default: 'Open',
			change: () => this.load_issues()
		});

		// Auto refresh toggle
		this.auto_refresh_toggle = this.page.add_field({
			label: 'Auto Refresh',
			fieldtype: 'Check',
			fieldname: 'auto_refresh',
			default: 1,
			change: () => this.toggle_auto_refresh()
		});

		// Main content area
		this.page.main.html(`
			<div class="monitor-dashboard">
				<!-- Statistics Cards -->
				<div class="row stats-cards" style="margin-bottom: 20px;">
					<div class="col-md-3">
						<div class="card bg-danger text-white">
							<div class="card-body">
								<h5 class="card-title">Critical Issues</h5>
								<h2 id="critical-count">0</h2>
							</div>
						</div>
					</div>
					<div class="col-md-3">
						<div class="card bg-warning text-white">
							<div class="card-body">
								<h5 class="card-title">High Priority</h5>
								<h2 id="high-count">0</h2>
							</div>
						</div>
					</div>
					<div class="col-md-3">
						<div class="card bg-info text-white">
							<div class="card-body">
								<h5 class="card-title">Medium Priority</h5>
								<h2 id="medium-count">0</h2>
							</div>
						</div>
					</div>
					<div class="col-md-3">
						<div class="card bg-success text-white">
							<div class="card-body">
								<h5 class="card-title">Total Resolved Today</h5>
								<h2 id="resolved-today-count">0</h2>
							</div>
						</div>
					</div>
				</div>

				<!-- Filter Controls -->
				<div class="row filter-controls" style="margin-bottom: 20px;">
					<div class="col-md-12">
						<div class="card">
							<div class="card-body">
								<div class="row">
									<div class="col-md-3">
										<label>Issue Type:</label>
										<select id="filter-issue-type" class="form-control">
											<option value="">All Types</option>
											<option value="Missing SLEs">Missing SLEs</option>
											<option value="Negative Stock">Negative Stock</option>
											<option value="Validation Error">Validation Error</option>
										</select>
									</div>
									<div class="col-md-3">
										<label>Priority:</label>
										<select id="filter-priority" class="form-control">
											<option value="">All Priorities</option>
											<option value="Critical">Critical</option>
											<option value="High">High</option>
											<option value="Medium">Medium</option>
											<option value="Low">Low</option>
										</select>
									</div>
									<div class="col-md-3">
										<label>Status:</label>
										<select id="filter-status" class="form-control">
											<option value="Open,In Progress">Open & In Progress</option>
											<option value="Open">Open Only</option>
											<option value="In Progress">In Progress Only</option>
											<option value="Resolved">Resolved</option>
											<option value="">All Status</option>
										</select>
									</div>
									<div class="col-md-3">
										<button id="apply-filters" class="btn btn-primary" style="margin-top: 25px;">Apply Filters</button>
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>

				<!-- Issues List -->
				<div class="row">
					<div class="col-md-12">
						<div class="card">
							<div class="card-header">
								<h5>Active Issues <span id="issues-count" class="badge badge-secondary">0</span></h5>
								<small class="text-muted">Last updated: <span id="last-updated">Never</span></small>
							</div>
							<div class="card-body">
								<div id="issues-table-container">
									<div class="text-center text-muted" style="padding: 40px;">
										<i class="fa fa-spinner fa-spin fa-2x"></i>
										<p style="margin-top: 10px;">Loading issues...</p>
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		`);
	}

	bind_events() {
		// Filter controls
		$('#apply-filters').on('click', () => this.load_issues());
		
		// Enter key on filters
		$('.filter-controls select').on('keypress', (e) => {
			if (e.which === 13) this.load_issues();
		});
	}

	setup_realtime_updates() {
		// Listen for real-time updates
		frappe.realtime.on('stock_entry_issue_detected', (data) => {
			this.show_new_issue_notification(data);
			this.load_issues(); // Refresh the list
		});
	}

	show_new_issue_notification(data) {
		frappe.show_alert({
			message: `⚠️ New issue detected in Stock Entry: ${data.stock_entry}`,
			indicator: 'red'
		});
		
		// Play notification sound if supported
		if ('Notification' in window) {
			new Notification('Stock Entry Issue Detected', {
				body: `Issues found in ${data.stock_entry}`,
				icon: '/assets/frappe/images/frappe-favicon.svg'
			});
		}
	}

	async load_issues() {
		try {
			frappe.show_progress('Loading Issues...', 50, 100);
			
			// Get status filter
			const status = this.status_filter.get_value() || 'Open';
			
			// Call the error log based method
			const response = await frappe.call({
				method: 'stock_ledger_fixer.stock_ledger_fixer.stock_entry_monitor.get_stock_entry_issues',
				args: { 
					limit: 50,
					status: status
				}
			});
			
			if (response.message.status === 'success') {
				this.render_issues(response.message.data);
				this.load_statistics();
				$('#last-updated').text(frappe.datetime.str_to_user(frappe.datetime.now_datetime()));
			} else {
				frappe.msgprint('Failed to load issues: ' + response.message.message);
			}
			
		} catch (error) {
			console.error('Error loading issues:', error);
			frappe.msgprint('Error loading issues');
		} finally {
			frappe.hide_progress();
		}
	}

	async load_statistics() {
		try {
			const response = await frappe.call({
				method: 'stock_ledger_fixer.stock_ledger_fixer.stock_entry_monitor.get_issue_statistics'
			});
			
			if (response.message.status === 'success') {
				const stats = response.message.data;
				$('#critical-count').text(stats.critical_issues || 0);
				$('#high-count').text(stats.high_issues || 0);
				$('#medium-count').text(stats.medium_issues || 0);
				$('#resolved-today-count').text(stats.resolved_today || 0);
			}
		} catch (error) {
			console.error('Error loading statistics:', error);
		}
	}

	render_issues(issues) {
		if (!issues || issues.length === 0) {
			$('#issues-table-container').html(`
				<div class="text-center text-muted" style="padding: 40px;">
					<i class="fa fa-check-circle fa-3x text-success"></i>
					<h4 style="margin-top: 15px;">No Active Issues!</h4>
					<p>All stock entries are processing correctly.</p>
				</div>
			`);
			$('#issues-count').text('0');
			return;
		}

		let table_html = `
			<div class="table-responsive">
				<table class="table table-striped table-hover">
					<thead class="thead-dark">
						<tr>
							<th>Stock Entry</th>
							<th>Issue Type</th>
							<th>Severity</th>
							<th>Status</th>
							<th>Detected</th>
							<th>Error Log</th>
							<th>Actions</th>
						</tr>
					</thead>
					<tbody>
		`;

		issues.forEach(issue => {
			const severity_class = {
				'Critical': 'badge-danger',
				'High': 'badge-warning', 
				'Medium': 'badge-info',
				'Low': 'badge-secondary'
			}[issue.severity] || 'badge-secondary';

			const status_class = issue.seen ? 'badge-success' : 'badge-danger';
			const status_text = issue.seen ? 'Resolved' : 'Open';

			table_html += `
				<tr data-issue="${issue.name}">
					<td>
						<a href="/app/stock-entry/${issue.stock_entry}" target="_blank">
							<strong>${issue.stock_entry}</strong>
						</a>
					</td>
					<td>${issue.issue_type}</td>
					<td><span class="badge ${severity_class}">${issue.severity}</span></td>
					<td><span class="badge ${status_class}">${status_text}</span></td>
					<td>
						<small>${frappe.datetime.str_to_user(issue.creation)}</small>
					</td>
					<td>
						<a href="/app/error-log/${issue.name}" target="_blank" class="btn btn-sm btn-outline-secondary">
							<i class="fa fa-external-link"></i> View Log
						</a>
					</td>
					<td>
						<div class="btn-group">
							<button class="btn btn-sm btn-primary analyze-btn" data-stock-entry="${issue.stock_entry}">
								<i class="fa fa-search"></i> Analyze
							</button>
							${!issue.seen ? `
								<button class="btn btn-sm btn-success resolve-btn" data-error-log="${issue.name}">
									<i class="fa fa-check"></i> Mark Resolved
								</button>
							` : ''}
						</div>
					</td>
				</tr>
			`;
		});

		table_html += `
					</tbody>
				</table>
			</div>
		`;

		$('#issues-table-container').html(table_html);
		$('#issues-count').text(issues.length);

		// Bind action buttons
		this.bind_action_buttons();
	}

	bind_action_buttons() {
		// Analyze button - opens Stock Entry Issues Detector
		$('.analyze-btn').on('click', function() {
			const stock_entry = $(this).data('stock-entry');
			frappe.set_route('stock-entry-issues-detector', {stock_entry: stock_entry});
		});

		// Resolve button
		$('.resolve-btn').on('click', (e) => {
			const error_log = $(e.target).closest('.resolve-btn').data('error-log');
			this.resolve_issue(error_log);
		});
	}

	update_statistics(stats) {
		$('#critical-count').text(stats.critical || 0);
		$('#high-count').text(stats.high || 0);
		$('#medium-count').text(stats.medium || 0);
		$('#resolved-today-count').text(stats.resolved_today || 0);
	}

	async resolve_issue(error_log_name) {
		const reason = await frappe.prompt({
			label: 'Resolution Notes',
			fieldtype: 'Small Text',
			fieldname: 'resolution_notes',
			reqd: false
		}, 'Mark Issue as Resolved');

		if (reason) {
			try {
				await frappe.call({
					method: 'stock_ledger_fixer.stock_ledger_fixer.stock_entry_monitor.resolve_issue',
					args: {
						error_log_name: error_log_name,
						resolution_notes: reason.resolution_notes
					}
				});

				frappe.show_alert({
					message: 'Issue marked as resolved',
					indicator: 'green'
				});

				this.load_issues();
			} catch (error) {
				frappe.msgprint('Failed to resolve issue');
			}
		}
	}

	start_auto_refresh() {
		if (this.auto_refresh_toggle.get_value()) {
			this.auto_refresh_interval = setInterval(() => {
				this.load_issues();
			}, 30000); // Refresh every 30 seconds
		}
	}

	stop_auto_refresh() {
		if (this.auto_refresh_interval) {
			clearInterval(this.auto_refresh_interval);
			this.auto_refresh_interval = null;
		}
	}

	toggle_auto_refresh() {
		if (this.auto_refresh_toggle.get_value()) {
			this.start_auto_refresh();
		} else {
			this.stop_auto_refresh();
		}
	}

	async clear_resolved_issues() {
		if (confirm('Clear all resolved issues from the past 7 days?')) {
			try {
				await frappe.call({
					method: 'stock_ledger_fixer.stock_ledger_fixer.stock_entry_monitor.clear_old_resolved_issues'
				});

				frappe.show_alert({
					message: 'Resolved issues cleared',
					indicator: 'green'
				});

				this.load_issues();
			} catch (error) {
				frappe.msgprint('Failed to clear resolved issues');
			}
		}
	}
}

// Page load function - must be at the end after class definition
frappe.pages['stock-entry-monitor'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Stock Entry Monitor - Real-time Issues via Error Logs',
		single_column: true
	});

	frappe.stock_entry_monitor = new StockEntryMonitor(page);
}
