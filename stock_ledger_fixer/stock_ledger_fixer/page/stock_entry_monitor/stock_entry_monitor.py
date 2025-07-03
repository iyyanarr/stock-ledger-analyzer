import frappe
from frappe.utils import getdate, add_days
import json

@frappe.whitelist()
def get_issues_for_monitor(filters=None):
	"""Get issues for the monitor dashboard with filtering"""
	try:
		if filters:
			filters = json.loads(filters) if isinstance(filters, str) else filters
		else:
			filters = {}
		
		# Import from the main stock_entry_monitor module
		from stock_ledger_fixer.stock_ledger_fixer.stock_entry_monitor import get_stock_entry_issues
		
		# Map filter parameters
		status_filter = filters.get('status', 'Open')
		issue_type_filter = filters.get('issue_type')
		priority_filter = filters.get('priority')
		
		# Get issues using the Error Log approach
		issues = get_stock_entry_issues(
			status=status_filter,
			issue_type=issue_type_filter, 
			priority=priority_filter
		)
		
		return {
			'success': True,
			'issues': issues
		}
		
	except Exception as e:
		frappe.log_error(f"Error in get_issues_for_monitor: {str(e)}")
		return {
			'success': False,
			'error': str(e)
		}

@frappe.whitelist()
def get_monitor_statistics():
	"""Get statistics for the monitor dashboard"""
	try:
		# Import from the main stock_entry_monitor module
		from stock_ledger_fixer.stock_ledger_fixer.stock_entry_monitor import get_issue_statistics
		
		stats = get_issue_statistics()
		
		return {
			'success': True,
			'stats': stats
		}
		
	except Exception as e:
		frappe.log_error(f"Error in get_monitor_statistics: {str(e)}")
		return {
			'success': False,
			'error': str(e)
		}

@frappe.whitelist()
def mark_issue_resolved(error_log_name, resolution_notes=None):
	"""Mark an issue as resolved"""
	try:
		# Import from the main stock_entry_monitor module
		from stock_ledger_fixer.stock_ledger_fixer.stock_entry_monitor import mark_issue_as_resolved
		
		mark_issue_as_resolved(error_log_name, resolution_notes)
		
		return {
			'success': True,
			'message': 'Issue marked as resolved successfully'
		}
		
	except Exception as e:
		frappe.log_error(f"Error in mark_issue_resolved: {str(e)}")
		return {
			'success': False,
			'error': str(e)
		}

@frappe.whitelist()
def clear_resolved_issues():
	"""Clear old resolved issues"""
	try:
		# Import from the main stock_entry_monitor module
		from stock_ledger_fixer.stock_ledger_fixer.stock_entry_monitor import cleanup_resolved_issues
		
		cleanup_resolved_issues()
		
		return {
			'success': True,
			'message': 'Resolved issues cleared successfully'
		}
		
	except Exception as e:
		frappe.log_error(f"Error in clear_resolved_issues: {str(e)}")
		return {
			'success': False,
			'error': str(e)
		}

@frappe.whitelist()
def run_stock_entry_analysis(stock_entry_name):
	"""Run detailed analysis on a stock entry"""
	try:
		# Import from the main stock_entry_monitor module
		from stock_ledger_fixer.stock_ledger_fixer.stock_entry_monitor import analyze_stock_entry
		
		analysis = analyze_stock_entry(stock_entry_name)
		
		return {
			'success': True,
			'analysis': analysis
		}
		
	except Exception as e:
		frappe.log_error(f"Error in run_stock_entry_analysis: {str(e)}")
		return {
			'success': False,
			'error': str(e)
		}
