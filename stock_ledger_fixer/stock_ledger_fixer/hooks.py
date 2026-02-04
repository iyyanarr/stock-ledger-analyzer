import frappe
from frappe.utils import now, add_to_date
import json


def validate_stock_entry_on_submit(doc, method):
    """
    Hook that runs immediately when a Stock Entry is submitted.
    Performs quick validation to detect obvious issues.
    """
    try:
        # Check if validation is enabled (with fallback if field doesn't exist)
        validation_enabled = True
        try:
            if frappe.get_meta("Stock Settings").has_field("enable_stock_ledger_validation"):
                validation_enabled = frappe.db.get_single_value("Stock Settings", "enable_stock_ledger_validation")
        except Exception:
            pass
            
        if not validation_enabled:
            return
        
        # Give ERPNext some time to create SLE entries
        frappe.enqueue(
            'stock_ledger_fixer.stock_ledger_fixer.hooks.delayed_validation',
            queue='short',
            timeout=300,
            stock_entry_name=doc.name,
            delay=10  # Wait 10 seconds before validation
        )
        
    except Exception as e:
        # Don't fail the stock entry submission if validation fails
        frappe.log_error(f"Error in stock entry validation hook: {str(e)}", "Stock Ledger Validator")


def schedule_stock_entry_validation(doc, method):
    """
    Hook that runs after Stock Entry is inserted (but before submit).
    Schedules validation for after submission.
    """
    # This is just a placeholder for now - main validation happens on_submit
    pass


def delayed_validation(stock_entry_name, retry_count=0):
    """
    Delayed validation function that checks for SLE issues after stock entry submission.
    """
    try:
        from stock_ledger_fixer.stock_ledger_fixer.utils import StockLedgerValidator
        
        # Wait a bit more if this is a retry
        if retry_count > 0:
            import time
            time.sleep(5 * retry_count)  # Progressive delay
        
        validator = StockLedgerValidator()
        result = validator.validate_stock_entry(stock_entry_name)
        
        if not result.get('valid'):
            # Create Stock Ledger Issue automatically
            create_automatic_issue(stock_entry_name, result)
            
            # Send notification if configured
            send_validation_notification(stock_entry_name, result)
        
        else:
            # Log successful validation
            frappe.log_error(
                f"Stock Entry {stock_entry_name} passed validation successfully", 
                "Stock Ledger Validator - Success"
            )
    
    except Exception as e:
        # Retry up to 3 times with progressive delays
        if retry_count < 3:
            frappe.enqueue(
                'stock_ledger_fixer.stock_ledger_fixer.hooks.delayed_validation',
                queue='short',
                timeout=300,
                stock_entry_name=stock_entry_name,
                retry_count=retry_count + 1,
                delay=30 * (retry_count + 1)  # 30s, 60s, 90s delays
            )
        else:
            frappe.log_error(
                f"Failed to validate {stock_entry_name} after 3 retries: {str(e)}", 
                "Stock Ledger Validator - Failed"
            )


def create_automatic_issue(stock_entry_name, validation_result):
    """
    Automatically create a Stock Ledger Issue when problems are detected.
    """
    try:
        # Check if issue already exists
        existing = frappe.db.exists("Stock Ledger Issue", {
            "stock_entry": stock_entry_name,
            "status": ["in", ["Open", "In Progress"]]
        })
        
        if existing:
            return existing
        
        # Determine issue type and priority
        issues = validation_result.get('issues', [])
        issue_types = [issue['type'] for issue in issues]
        
        # Set priority based on issue severity
        priority = "Low"
        if 'missing_entry' in issue_types:
            priority = "High"
        elif len(issues) > 3:
            priority = "Medium"
        
        # Create the issue
        issue_doc = frappe.get_doc({
            "doctype": "Stock Ledger Issue",
            "stock_entry": stock_entry_name,
            "status": "Open",
            "priority": priority,
            "issue_description": f"Automatically detected: {len(issues)} issues found during submission validation"
        })
        
        issue_doc.insert()
        
        frappe.log_error(
            f"Auto-created Stock Ledger Issue {issue_doc.name} for {stock_entry_name}",
            "Stock Ledger Auto-Detection"
        )
        
        return issue_doc.name
        
    except Exception as e:
        frappe.log_error(f"Error creating automatic issue for {stock_entry_name}: {str(e)}")
        return None


def send_validation_notification(stock_entry_name, validation_result):
    """
    Send notification when stock ledger issues are detected.
    """
    try:
        # Get notification settings
        notification_enabled = False
        notification_users = None
        
        meta = frappe.get_meta("Stock Settings")
        if meta.has_field("notify_on_stock_ledger_issues"):
            notification_enabled = frappe.db.get_single_value("Stock Settings", "notify_on_stock_ledger_issues")
        
        if meta.has_field("stock_ledger_notification_users"):
            notification_users = frappe.db.get_single_value("Stock Settings", "stock_ledger_notification_users")
        
        if not notification_enabled or not notification_users:
            return
        
        # Parse notification users
        if isinstance(notification_users, str):
            users = [user.strip() for user in notification_users.split(',')]
        else:
            users = [notification_users]
        
        # Create notification content
        issues = validation_result.get('issues', [])
        issue_summary = f"{len(issues)} issues detected"
        
        message = f"""
        <h3>Stock Ledger Issue Detected</h3>
        <p><strong>Stock Entry:</strong> {stock_entry_name}</p>
        <p><strong>Issues Found:</strong> {issue_summary}</p>
        <p><strong>Expected SLE Count:</strong> {validation_result.get('expected_count', 'N/A')}</p>
        <p><strong>Actual SLE Count:</strong> {validation_result.get('actual_count', 'N/A')}</p>
        <p><strong>Action Required:</strong> Please review and fix using the Stock Ledger Analyzer</p>
        <p><a href="/app/stock-ledger-analyzer">Open Stock Ledger Analyzer</a></p>
        """
        
        # Send notification to users
        for user in users:
            if frappe.db.exists("User", user):
                frappe.get_doc({
                    "doctype": "Notification Log",
                    "subject": f"Stock Ledger Issue: {stock_entry_name}",
                    "email_content": message,
                    "for_user": user,
                    "type": "Alert"
                }).insert(ignore_permissions=True)
        
    except Exception as e:
        frappe.log_error(f"Error sending validation notification: {str(e)}")


def get_stock_entry_validation_settings():
    """
    Get validation settings with defaults.
    """
    meta = frappe.get_meta("Stock Settings")
    return {
        "enable_validation": frappe.db.get_single_value("Stock Settings", "enable_stock_ledger_validation") if meta.has_field("enable_stock_ledger_validation") else False,
        "auto_create_issues": frappe.db.get_single_value("Stock Settings", "auto_create_stock_ledger_issues") if meta.has_field("auto_create_stock_ledger_issues") else True,
        "send_notifications": frappe.db.get_single_value("Stock Settings", "notify_on_stock_ledger_issues") if meta.has_field("notify_on_stock_ledger_issues") else False,
        "validation_delay": frappe.db.get_single_value("Stock Settings", "stock_ledger_validation_delay") if meta.has_field("stock_ledger_validation_delay") else 10,
        "max_retries": frappe.db.get_single_value("Stock Settings", "stock_ledger_validation_retries") if meta.has_field("stock_ledger_validation_retries") else 3
    }
