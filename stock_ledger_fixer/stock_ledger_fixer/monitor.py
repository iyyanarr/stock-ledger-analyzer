import frappe
from frappe.utils import cint
from stock_ledger_fixer.stock_ledger_fixer.doctype.stock_entry_issue_log.stock_entry_issue_log import StockEntryIssueLog
import json

def monitor_stock_entry_on_submit(doc, method):
	"""
	Monitor Stock Entry when submitted to detect issues automatically
	This runs after every Stock Entry submission
	"""
	try:
		# Only monitor if the feature is enabled
		if not frappe.db.get_single_value("Stock Ledger Fixer Settings", "enable_real_time_monitoring"):
			return
		
		# Run the same detection logic as the Issues Detector
		issues_detected = detect_stock_entry_issues(doc.name)
		
		if issues_detected:
			frappe.publish_realtime("stock_entry_issue_detected", {
				"stock_entry": doc.name,
				"issues": issues_detected
			}, user=frappe.session.user)
			
	except Exception as e:
		# Log error but don't block the stock entry submission
		frappe.log_error(
			message=f"Error monitoring stock entry {doc.name}: {str(e)}",
			title="Stock Entry Monitoring Error"
		)

def detect_stock_entry_issues(stock_entry_name):
	"""
	Detect issues in a stock entry and log them
	Returns list of detected issues
	"""
	issues_detected = []
	
	try:
		# Check for missing SLEs
		missing_sles = check_missing_sles(stock_entry_name)
		if missing_sles["has_issues"]:
			issue = StockEntryIssueLog.log_issue(
				stock_entry_name=stock_entry_name,
				issue_type="Missing SLEs",
				issue_summary=f"Missing {missing_sles['missing_count']} SLEs for {missing_sles['total_items']} items",
				issue_details=missing_sles["details"],
				missing_sles_count=missing_sles['missing_count'],
				affected_items=missing_sles["affected_items"],
				priority="High" if missing_sles['missing_count'] > 5 else "Medium"
			)
			issues_detected.append({
				"type": "Missing SLEs",
				"issue_name": issue.name,
				"summary": issue.issue_summary
			})
		
		# Check for negative stock
		negative_stock = check_negative_stock_issues(stock_entry_name)
		if negative_stock["has_issues"]:
			issue = StockEntryIssueLog.log_issue(
				stock_entry_name=stock_entry_name,
				issue_type="Negative Stock",
				issue_summary=f"{negative_stock['negative_items_count']} items have negative stock",
				issue_details=negative_stock["details"],
				negative_stock_items_count=negative_stock['negative_items_count'],
				affected_items=negative_stock["affected_items"],
				affected_warehouses=negative_stock["affected_warehouses"],
				priority="Critical" if negative_stock['negative_items_count'] > 3 else "High"
			)
			issues_detected.append({
				"type": "Negative Stock", 
				"issue_name": issue.name,
				"summary": issue.issue_summary
			})
			
	except Exception as e:
		frappe.log_error(
			message=f"Error detecting issues for {stock_entry_name}: {str(e)}",
			title="Issue Detection Error"
		)
	
	return issues_detected

def check_missing_sles(stock_entry_name):
	"""Check if stock entry has missing SLEs"""
	try:
		stock_entry = frappe.get_doc("Stock Entry", stock_entry_name)
		
		# Count expected SLEs vs actual SLEs
		expected_sles = len(stock_entry.items)
		actual_sles = frappe.db.count("Stock Ledger Entry", {"voucher_no": stock_entry_name})
		
		missing_count = max(0, expected_sles - actual_sles)
		
		if missing_count > 0:
			affected_items = [item.item_code for item in stock_entry.items]
			details = f"""Stock Entry: {stock_entry_name}
Expected SLEs: {expected_sles}
Actual SLEs: {actual_sles}
Missing: {missing_count}

Items involved: {', '.join(affected_items[:10])}{'...' if len(affected_items) > 10 else ''}"""
			
			return {
				"has_issues": True,
				"missing_count": missing_count,
				"total_items": len(affected_items),
				"affected_items": affected_items,
				"details": details
			}
		
		return {"has_issues": False}
		
	except Exception as e:
		frappe.log_error(f"Error checking missing SLEs for {stock_entry_name}: {str(e)}")
		return {"has_issues": False}

def check_negative_stock_issues(stock_entry_name):
	"""Check if stock entry caused negative stock"""
	try:
		stock_entry = frappe.get_doc("Stock Entry", stock_entry_name)
		
		# Check for negative stock in related items and warehouses
		negative_items = []
		affected_warehouses = set()
		
		for item in stock_entry.items:
			warehouses_to_check = []
			if item.s_warehouse:
				warehouses_to_check.append(item.s_warehouse)
			if item.t_warehouse:
				warehouses_to_check.append(item.t_warehouse)
			
			for warehouse in warehouses_to_check:
				# Check current stock balance
				current_balance = frappe.db.sql("""
					SELECT SUM(actual_qty) as balance
					FROM `tabStock Ledger Entry`
					WHERE item_code = %s AND warehouse = %s
				""", [item.item_code, warehouse], as_dict=1)
				
				if current_balance and current_balance[0]["balance"] and current_balance[0]["balance"] < 0:
					negative_items.append({
						"item_code": item.item_code,
						"warehouse": warehouse,
						"balance": current_balance[0]["balance"],
						"batch_no": item.batch_no
					})
					affected_warehouses.add(warehouse)
		
		if negative_items:
			details = f"""Stock Entry: {stock_entry_name} caused negative stock:

Negative Items:
""" + "\n".join([f"- {item['item_code']} in {item['warehouse']}: {item['balance']}" + 
				(f" (Batch: {item['batch_no']})" if item['batch_no'] else "") 
				for item in negative_items])
			
			return {
				"has_issues": True,
				"negative_items_count": len(negative_items),
				"affected_items": [item["item_code"] for item in negative_items],
				"affected_warehouses": list(affected_warehouses),
				"details": details
			}
		
		return {"has_issues": False}
		
	except Exception as e:
		frappe.log_error(f"Error checking negative stock for {stock_entry_name}: {str(e)}")
		return {"has_issues": False}
