frappe.ui.form.on('Stock Ledger Fixer Settings', {
	refresh: function(frm) {
		frm.add_custom_button(__('View Stock Entry Monitor'), function() {
			frappe.set_route('stock-entry-monitor');
		});
		
		frm.add_custom_button(__('View Stock Entry Issues Detector'), function() {
			frappe.set_route('stock-entry-issues-detector');
		});
		
		if (frm.doc.enable_real_time_monitoring) {
			frm.dashboard.set_indicator(__('Real-time Monitoring Enabled'), 'green');
		} else {
			frm.dashboard.set_indicator(__('Real-time Monitoring Disabled'), 'red');
		}
	},
	
	enable_real_time_monitoring: function(frm) {
		if (frm.doc.enable_real_time_monitoring) {
			frappe.msgprint(__('Real-time monitoring will start detecting issues on new Stock Entry submissions.'));
		} else {
			frappe.msgprint(__('Real-time monitoring has been disabled.'));
		}
	}
});
