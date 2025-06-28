frappe.pages['stock-ledger-analyzer'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Stock Ledger Analyzer',
		single_column: true
	});

	frappe.stock_ledger_analyzer = new StockLedgerAnalyzer(wrapper, page);
}

class StockLedgerAnalyzer {
	constructor(wrapper, page) {
		this.wrapper = wrapper;
		this.page = page;
		this.make();
	}

	make() {
		this.setup_page_body();
		this.setup_filters();
		this.setup_actions();
		this.setup_results_area();
		this.load_summary();
	}

	setup_page_body() {
		this.body = $('<div class="stock-analyzer-page">').appendTo(this.page.main);
	}

	setup_filters() {
		this.filters_area = $(`
			<div class="row mb-3">
				<div class="col-md-3">
					<div class="form-group" id="from_date_wrapper"></div>
				</div>
				<div class="col-md-3">
					<div class="form-group" id="to_date_wrapper"></div>
				</div>
				<div class="col-md-3">
					<div class="form-group" id="company_wrapper"></div>
				</div>
				<div class="col-md-3">
					<div class="form-group" id="warehouse_wrapper"></div>
				</div>
			</div>
		`).appendTo(this.body);
		
		this.from_date_field = frappe.ui.form.make_control({
			df: {
				fieldtype: 'Date',
				label: 'From Date',
				fieldname: 'from_date',
				default: frappe.datetime.add_months(frappe.datetime.get_today(), -1)
			},
			parent: this.filters_area.find('#from_date_wrapper'),
			render_input: true
		});
		
		this.to_date_field = frappe.ui.form.make_control({
			df: {
				fieldtype: 'Date',
				label: 'To Date',
				fieldname: 'to_date',
				default: frappe.datetime.get_today()
			},
			parent: this.filters_area.find('#to_date_wrapper'),
			render_input: true
		});
		
		this.company_field = frappe.ui.form.make_control({
			df: {
				fieldtype: 'Link',
				label: 'Company',
				fieldname: 'company',
				options: 'Company'
			},
			parent: this.filters_area.find('#company_wrapper'),
			render_input: true
		});
		
		this.warehouse_field = frappe.ui.form.make_control({
			df: {
				fieldtype: 'Link',
				label: 'Warehouse',
				fieldname: 'warehouse',
				options: 'Warehouse'
			},
			parent: this.filters_area.find('#warehouse_wrapper'),
			render_input: true
		});
	}

	setup_actions() {
		this.page.set_primary_action('Analyze', () => {
			this.analyze_stock_ledger();
		});
	}

	setup_results_area() {
		this.results_area = $(`
			<div class="results-container mt-4">
				<div class="results-summary"></div>
				<div class="results-table"></div>
			</div>
		`).appendTo(this.body);
	}

	get_filters() {
		return {
			from_date: this.from_date_field.get_value(),
			to_date: this.to_date_field.get_value(),
			company: this.company_field.get_value(),
			warehouse: this.warehouse_field.get_value()
		};
	}

	analyze_stock_ledger() {
		const filters = this.get_filters();
		
		// Show loading indicator
		this.results_area.find('.results-summary').html('<div class="alert alert-info">Analyzing stock entries...</div>');
		this.results_area.find('.results-table').html('');
		
		frappe.call({
			method: 'stock_ledger_fixer.stock_ledger_fixer.page.stock_ledger_analyzer.stock_ledger_analyzer.analyze_stock_entries',
			args: { filters: filters },
			callback: (r) => {
				if (r.message) {
					this.display_results(r.message);
				} else {
					this.results_area.find('.results-summary').html('<div class="alert alert-danger">No response received from server</div>');
				}
			},
			error: (r) => {
				console.error("Stock Analyzer Error:", r);
				this.results_area.find('.results-summary').html('<div class="alert alert-danger">Error occurred: ' + (r.exception || 'Unknown error') + '</div>');
			}
		});
	}

	load_summary() {
		frappe.call({
			method: 'stock_ledger_fixer.stock_ledger_fixer.page.stock_ledger_analyzer.stock_ledger_analyzer.get_summary',
			callback: (r) => {
				if (r.message) {
					this.display_summary(r.message);
				}
			}
		});
	}

	display_summary(data) {
		const html = `
			<div class="alert alert-info">
				<strong>Quick Summary:</strong> 
				${data.total_entries || 0} total entries, ${data.missing_sle || 0} missing SLE entries<br>
				<small>${data.summary || ''}</small>
			</div>
		`;
		this.results_area.find('.results-summary').html(html);
	}

	display_results(data) {
		const summary_html = `
			<div class="row">
				<div class="col-md-3">
					<div class="alert alert-danger">
						<strong>Scenario 1:</strong><br>
						<small>No SLE Created</small><br>
						<h4>${data.scenario_1_missing || 0}</h4>
					</div>
				</div>
				<div class="col-md-3">
					<div class="alert alert-warning">
						<strong>Scenario 2:</strong><br>
						<small>Partial SLE</small><br>
						<h4>${data.scenario_2_partial || 0}</h4>
					</div>
				</div>
				<div class="col-md-3">
					<div class="alert alert-info">
						<strong>Total Analyzed:</strong><br>
						<small>${data.summary || ''}</small><br>
						<h4>${data.total_analyzed || 0}</h4>
					</div>
				</div>
				<div class="col-md-3">
					<div class="alert alert-primary">
						<strong>Total Problems:</strong><br>
						<small>Issues Found</small><br>
						<h4>${data.total_problematic || 0}</h4>
					</div>
				</div>
			</div>
		`;

		this.results_area.find('.results-summary').html(summary_html);

		if (data.problematic_entries && data.problematic_entries.length > 0) {
			this.create_results_table(data.problematic_entries);
		} else {
			this.results_area.find('.results-table').html('<div class="alert alert-success">No issues found!</div>');
		}
	}

	create_results_table(data) {
		const table_html = `
			<h4>Problematic Entries (SLE Issues)</h4>
			<table class="table table-striped">
				<thead>
					<tr>
						<th>Stock Entry</th>
						<th>Date</th>
						<th>Type</th>
						<th>Issue Type</th>
						<th>Expected SLE</th>
						<th>Actual SLE</th>
						<th>Details</th>
					</tr>
				</thead>
				<tbody>
					${data.map(row => `
						<tr>
							<td><a href="/app/stock-entry/${row.name}" target="_blank">${row.name}</a></td>
							<td>${row.posting_date}</td>
							<td>${row.stock_entry_type || ''}</td>
							<td>
								<span class="badge ${row.issue_type === 'No SLE Created' ? 'badge-danger' : 'badge-warning'}">
									${row.issue_type}
								</span>
							</td>
							<td>${row.expected_sle || 0}</td>
							<td>${row.actual_sle || 0}</td>
							<td>
								<small>${row.issue_details || ''}</small>
								${row.movements ? `<br><small class="text-muted">${row.movements.slice(0, 2).join(', ')}</small>` : ''}
							</td>
						</tr>
					`).join('')}
				</tbody>
			</table>
		`;
		
		this.results_area.find('.results-table').html(table_html);
	}
}