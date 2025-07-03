import frappe
from frappe import _
from frappe.utils import nowdate, get_datetime, add_days
import json

def log_stock_entry_issue(stock_entry_name, issue_type, details, severity="Medium"):
    """
    Log stock entry issues as structured error logs for monitoring
    """
    try:
        # Create structured error data
        error_data = {
            "stock_entry": stock_entry_name,
            "issue_type": issue_type,
            "severity": severity,
            "details": details,
            "timestamp": get_datetime(),
            "resolved": False
        }
        
        # Create a formatted error message with structured data
        error_message = f"""STOCK_ENTRY_ISSUE: {issue_type} - {stock_entry_name}

Stock Entry Issue Detected: {stock_entry_name}
        
Issue Type: {issue_type}
Severity: {severity}
Details: {json.dumps(details, indent=2)}

This is an automatic detection for monitoring purposes.
Use Stock Entry Issues Detector to resolve this issue.
        """
        
        # Log as error with title for identification
        frappe.log_error(
            message=error_message,
            title=f"STOCK_ENTRY_ISSUE: {issue_type} - {stock_entry_name}",
            reference_doctype="Stock Entry",
            reference_name=stock_entry_name
        )
        
    except Exception as e:
        # Don't let logging errors affect the main transaction
        frappe.log_error(f"Failed to log stock entry issue: {str(e)}", "Stock Entry Monitor Error")

def check_stock_entry_on_submit(doc, method):
    """
    Hook function to check for issues when stock entry is submitted
    This runs AFTER submission to avoid transaction conflicts
    """
    try:
        # Only check if monitoring is enabled
        if not frappe.db.get_single_value("Stock Ledger Fixer Settings", "enable_real_time_monitoring"):
            return
            
        # Schedule background check to avoid deadlocks
        frappe.enqueue(
            'stock_ledger_fixer.stock_ledger_fixer.stock_entry_monitor.analyze_stock_entry_issues',
            queue='short',
            timeout=60,
            stock_entry_name=doc.name,
            is_async=True
        )
        
    except Exception as e:
        # Don't let monitoring errors affect the main transaction
        frappe.log_error(f"Stock entry monitoring hook failed: {str(e)}", "Stock Entry Monitor Hook Error")

def analyze_stock_entry_issues(stock_entry_name):
    """
    Background job to analyze stock entry for issues and log them
    """
    try:
        # Import the analysis function from existing detector
        from stock_ledger_fixer.stock_ledger_fixer.page.stock_entry_issues_detector.stock_entry_issues_detector import analyze_stock_entry_for_issues
        
        # Analyze the stock entry
        result = analyze_stock_entry_for_issues(stock_entry_name)
        
        if result.get("status") == "success" and result.get("issues"):
            issues = result.get("issues", [])
            
            for issue in issues:
                # Log each issue type separately
                log_stock_entry_issue(
                    stock_entry_name=stock_entry_name,
                    issue_type=issue.get("type", "Unknown Issue"),
                    details={
                        "description": issue.get("description"),
                        "severity": issue.get("severity"),
                        "items_affected": issue.get("items_affected", []),
                        "analysis_data": issue.get("data", {})
                    },
                    severity=issue.get("severity", "Medium")
                )
        
    except Exception as e:
        frappe.log_error(f"Background stock entry analysis failed for {stock_entry_name}: {str(e)}", "Stock Entry Analysis Error")

@frappe.whitelist()
def get_stock_entry_issues(limit=50, status="Open"):
    """
    Get stock entry issues from error logs
    """
    try:
        # Query error logs with stock entry issue pattern
        filters = {
            "method": ["like", "STOCK_ENTRY_ISSUE:%"],
            "seen": 0 if status == "Open" else 1
        }
        
        error_logs = frappe.get_all(
            "Error Log",
            filters=filters,
            fields=["name", "method", "error", "creation", "reference_doctype", "reference_name", "seen"],
            order_by="creation desc",
            limit=limit
        )
        
        # Parse and structure the data
        issues = []
        for log in error_logs:
            try:
                # Extract stock entry name and issue type from method
                method_parts = log.method.replace("STOCK_ENTRY_ISSUE: ", "").split(" - ")
                issue_type = method_parts[0] if len(method_parts) > 0 else "Unknown"
                stock_entry = method_parts[1] if len(method_parts) > 1 else log.reference_name
                
                # Try to parse details from error message
                details = {}
                if "Details:" in log.error:
                    try:
                        details_str = log.error.split("Details:")[1].strip()
                        details = json.loads(details_str.split("\n")[0])
                    except:
                        pass
                
                issues.append({
                    "name": log.name,
                    "stock_entry": stock_entry,
                    "issue_type": issue_type,
                    "severity": details.get("severity", "Medium"),
                    "creation": log.creation,
                    "seen": log.seen,
                    "details": details
                })
            except Exception as e:
                continue
        
        return {
            "status": "success",
            "data": issues
        }
        
    except Exception as e:
        frappe.log_error(message=frappe.get_traceback(), title="Get Stock Entry Issues Error")
        return {"status": "error", "message": str(e)}

@frappe.whitelist()
def resolve_issue(error_log_name, resolution_notes=None):
    """
    Mark an issue as resolved by marking the error log as seen
    """
    try:
        frappe.db.set_value("Error Log", error_log_name, "seen", 1)
        
        # Add resolution notes if provided
        if resolution_notes:
            frappe.db.set_value("Error Log", error_log_name, "error", 
                frappe.db.get_value("Error Log", error_log_name, "error") + 
                f"\n\nResolution Notes: {resolution_notes}")
        
        frappe.db.commit()
        
        return {"status": "success", "message": "Issue marked as resolved"}
        
    except Exception as e:
        return {"status": "error", "message": str(e)}

@frappe.whitelist()
def clear_old_resolved_issues():
    """
    Clear old resolved issues from the past 7 days
    """
    try:
        # Get cutoff date (7 days ago)
        cutoff_date = add_days(nowdate(), -7)
        
        # Delete old resolved error logs
        frappe.db.delete("Error Log", {
            "method": ["like", "STOCK_ENTRY_ISSUE:%"],
            "seen": 1,
            "creation": ["<", cutoff_date]
        })
        
        frappe.db.commit()
        
        return {"status": "success", "message": "Old resolved issues cleared"}
        
    except Exception as e:
        return {"status": "error", "message": str(e)}

@frappe.whitelist()
def get_issue_statistics():
    """
    Get detailed statistics about stock entry issues
    """
    try:
        # Count open issues
        open_issues = frappe.db.count("Error Log", {
            "method": ["like", "STOCK_ENTRY_ISSUE:%"],
            "seen": 0
        })
        
        # Count total issues today
        today_issues = frappe.db.count("Error Log", {
            "method": ["like", "STOCK_ENTRY_ISSUE:%"],
            "creation": [">=", nowdate()]
        })
        
        # Count resolved today
        resolved_today = frappe.db.count("Error Log", {
            "method": ["like", "STOCK_ENTRY_ISSUE:%"],
            "seen": 1,
            "creation": [">=", nowdate()]
        })
        
        # Count by severity (need to parse from error message)
        critical_issues = frappe.db.count("Error Log", {
            "method": ["like", "STOCK_ENTRY_ISSUE:%"],
            "error": ["like", "%Severity: Critical%"],
            "seen": 0
        })
        
        high_issues = frappe.db.count("Error Log", {
            "method": ["like", "STOCK_ENTRY_ISSUE:%"],
            "error": ["like", "%Severity: High%"],
            "seen": 0
        })
        
        medium_issues = frappe.db.count("Error Log", {
            "method": ["like", "STOCK_ENTRY_ISSUE:%"],
            "error": ["like", "%Severity: Medium%"],
            "seen": 0
        })
        
        return {
            "status": "success",
            "data": {
                "open_issues": open_issues,
                "today_issues": today_issues,
                "resolved_today": resolved_today,
                "critical_issues": critical_issues,
                "high_issues": high_issues,
                "medium_issues": medium_issues
            }
        }
        
    except Exception as e:
        return {"status": "error", "message": str(e)}

@frappe.whitelist()
def mark_issue_as_resolved(error_log_name, resolution_notes=None):
    """
    Mark an issue as resolved by marking the error log as seen
    """
    try:
        frappe.db.set_value("Error Log", error_log_name, "seen", 1)
        
        # Add resolution notes if provided
        if resolution_notes:
            current_error = frappe.db.get_value("Error Log", error_log_name, "error")
            frappe.db.set_value("Error Log", error_log_name, "error", 
                current_error + f"\n\nResolution Notes: {resolution_notes}")
        
        frappe.db.commit()
        
        return {"status": "success", "message": "Issue marked as resolved"}
        
    except Exception as e:
        return {"status": "error", "message": str(e)}

@frappe.whitelist()
def cleanup_resolved_issues():
    """
    Clean up old resolved issues
    """
    try:
        return clear_old_resolved_issues()
    except Exception as e:
        return {"status": "error", "message": str(e)}

@frappe.whitelist()
def analyze_stock_entry(stock_entry_name):
    """
    Analyze a specific stock entry for issues
    """
    try:
        # Import the analysis function from existing detector
        from stock_ledger_fixer.stock_ledger_fixer.page.stock_entry_issues_detector.stock_entry_issues_detector import analyze_stock_entry_for_issues
        
        # Analyze the stock entry
        result = analyze_stock_entry_for_issues(stock_entry_name)
        
        return {
            "status": "success",
            "data": result
        }
        
    except Exception as e:
        frappe.log_error(f"Error analyzing stock entry {stock_entry_name}: {str(e)}")
        return {
            "status": "error",
            "message": str(e)
        }
