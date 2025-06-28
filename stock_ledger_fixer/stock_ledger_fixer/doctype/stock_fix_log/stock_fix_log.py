# Copyright (c) 2025, rsvasanth and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import now
import time


class StockFixLog(Document):
    def validate(self):
        if not self.executed_by:
            self.executed_by = frappe.session.user
        if not self.executed_on:
            self.executed_on = now()


def create_fix_log(stock_entry, action_type, status, action_details=None, error_log=None, 
                   before_sle=0, after_sle=0, before_gl=0, after_gl=0, execution_time=0,
                   stock_ledger_issue=None):
    """Create a fix log entry"""
    
    log_doc = frappe.get_doc({
        "doctype": "Stock Fix Log",
        "stock_entry": stock_entry,
        "stock_ledger_issue": stock_ledger_issue,
        "action_type": action_type,
        "status": status,
        "before_fix_sle_count": before_sle,
        "after_fix_sle_count": after_sle,
        "before_fix_gl_count": before_gl,
        "after_fix_gl_count": after_gl,
        "action_details": action_details,
        "error_log": error_log,
        "execution_time_ms": execution_time,
        "executed_by": frappe.session.user,
        "executed_on": now()
    })
    
    log_doc.insert()
    return log_doc.name
