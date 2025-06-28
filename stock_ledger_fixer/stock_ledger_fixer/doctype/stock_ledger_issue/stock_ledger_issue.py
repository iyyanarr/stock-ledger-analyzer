# Copyright (c) 2025, rsvasanth and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import now, get_datetime
from stock_ledger_fixer.stock_ledger_fixer.utils import StockLedgerValidator


class StockLedgerIssue(Document):
    def validate(self):
        self.set_defaults()
        self.fetch_stock_entry_details()
        self.analyze_issue()
    
    def set_defaults(self):
        if not self.created_by:
            self.created_by = frappe.session.user
        if not self.created_on:
            self.created_on = now()
    
    def fetch_stock_entry_details(self):
        """Fetch details from the linked stock entry"""
        if self.stock_entry:
            stock_entry = frappe.get_doc("Stock Entry", self.stock_entry)
            self.posting_date = stock_entry.posting_date
            self.company = stock_entry.company
            self.stock_entry_type = stock_entry.stock_entry_type
            
            # Calculate total value impact
            total_value = stock_entry.total_outgoing_value + stock_entry.total_incoming_value
            self.total_value_impact = total_value
    
    def analyze_issue(self):
        """Analyze the stock entry and populate issue details"""
        if self.stock_entry and not self.issue_description:
            validator = StockLedgerValidator()
            result = validator.validate_stock_entry(self.stock_entry)
            
            if not result.get('valid'):
                self.expected_sle_count = result.get('expected_count', 0)
                self.actual_sle_count = result.get('actual_count', 0)
                
                issues = result.get('issues', [])
                if issues:
                    # Set issue type based on the most critical issue
                    issue_types = [issue['type'] for issue in issues]
                    if 'missing_entry' in issue_types:
                        self.issue_type = "Missing SLE"
                    elif 'wrong_qty_direction' in issue_types:
                        self.issue_type = "Wrong Qty Direction"
                    elif 'qty_mismatch' in issue_types:
                        self.issue_type = "Qty Mismatch"
                    elif 'extra_entry' in issue_types:
                        self.issue_type = "Extra SLE"
                    else:
                        self.issue_type = "Incomplete SLE"
                    
                    # Create detailed description
                    missing_items = []
                    for issue in issues:
                        if issue['type'] == 'missing_entry':
                            missing_items.append(f"{issue['item_code']} in {issue['warehouse']}")
                    
                    self.missing_items_count = len(missing_items)
                    self.missing_items_details = "; ".join(missing_items) if missing_items else ""
                    
                    # Create issue description
                    self.issue_description = f"Found {len(issues)} issues: " + "; ".join([
                        f"{issue['type']} for {issue.get('item_code', 'N/A')} in {issue.get('warehouse', 'N/A')}"
                        for issue in issues[:5]  # Limit to first 5 issues
                    ])
    
    def on_submit(self):
        """Actions to perform when the issue is submitted"""
        if self.status == "Open":
            self.status = "In Progress"
    
    def resolve_issue(self, resolution_notes=None, auto_fix=False):
        """Mark the issue as resolved"""
        if auto_fix:
            # Attempt to automatically fix the issue
            validator = StockLedgerValidator()
            result = validator.fix_stock_entry(self.stock_entry)
            
            if result.get('success'):
                self.status = "Resolved"
                self.resolved_by = frappe.session.user
                self.resolved_on = now()
                self.resolution_notes = resolution_notes or f"Auto-fixed: {result.get('message', 'Fixed successfully')}"
                return {"success": True, "message": "Issue resolved automatically"}
            else:
                return {"success": False, "error": result.get('error', 'Auto-fix failed')}
        else:
            # Manual resolution
            self.status = "Resolved"
            self.resolved_by = frappe.session.user
            self.resolved_on = now()
            self.resolution_notes = resolution_notes or "Manually resolved"
            return {"success": True, "message": "Issue marked as resolved"}
    
    @frappe.whitelist()
    def try_auto_fix(self):
        """Try to automatically fix the issue"""
        return self.resolve_issue(auto_fix=True)
    
    @frappe.whitelist()
    def reanalyze(self):
        """Re-analyze the stock entry to check if issue still exists"""
        validator = StockLedgerValidator()
        result = validator.validate_stock_entry(self.stock_entry)
        
        if result.get('valid'):
            self.status = "Resolved"
            self.resolved_by = frappe.session.user
            self.resolved_on = now()
            self.resolution_notes = "Issue resolved - stock entry is now valid"
            self.save()
            return {"success": True, "message": "Issue has been resolved"}
        else:
            # Update the analysis
            self.analyze_issue()
            self.save()
            return {"success": False, "message": "Issue still exists", "issues": result.get('issues', [])}


@frappe.whitelist()
def create_issues_from_analysis(filters=None):
    """Create Stock Ledger Issue records from analysis results"""
    
    from stock_ledger_fixer.stock_ledger_fixer.page.stock_ledger_analyzer.stock_ledger_analyzer import analyze_stock_entries
    
    # Get problematic entries
    result = analyze_stock_entries(filters)
    problematic_entries = result.get('problematic_entries', [])
    
    created_count = 0
    skipped_count = 0
    
    for entry in problematic_entries:
        # Check if issue already exists
        existing = frappe.db.exists("Stock Ledger Issue", {
            "stock_entry": entry['name'],
            "status": ["in", ["Open", "In Progress"]]
        })
        
        if existing:
            skipped_count += 1
            continue
        
        # Create new issue
        issue_doc = frappe.get_doc({
            "doctype": "Stock Ledger Issue",
            "stock_entry": entry['name'],
            "issue_type": entry.get('issue_type', 'Unknown'),
            "status": "Open",
            "priority": "Medium"
        })
        
        try:
            issue_doc.insert()
            created_count += 1
        except Exception as e:
            frappe.log_error(f"Error creating issue for {entry['name']}: {str(e)}")
    
    return {
        "success": True,
        "created_count": created_count,
        "skipped_count": skipped_count,
        "total_problems": len(problematic_entries)
    }


@frappe.whitelist()
def bulk_resolve_issues(issue_names, resolution_method="manual", resolution_notes=None):
    """Bulk resolve multiple issues"""
    
    if isinstance(issue_names, str):
        import json
        issue_names = json.loads(issue_names)
    
    results = []
    
    for issue_name in issue_names:
        try:
            issue_doc = frappe.get_doc("Stock Ledger Issue", issue_name)
            
            if resolution_method == "auto_fix":
                result = issue_doc.resolve_issue(resolution_notes, auto_fix=True)
            else:
                result = issue_doc.resolve_issue(resolution_notes, auto_fix=False)
            
            if result.get('success'):
                issue_doc.save()
            
            results.append({
                "issue": issue_name,
                "result": result
            })
            
        except Exception as e:
            results.append({
                "issue": issue_name,
                "result": {"success": False, "error": str(e)}
            })
    
    success_count = sum(1 for r in results if r['result'].get('success'))
    
    return {
        "success": True,
        "total_processed": len(issue_names),
        "success_count": success_count,
        "results": results
    }
