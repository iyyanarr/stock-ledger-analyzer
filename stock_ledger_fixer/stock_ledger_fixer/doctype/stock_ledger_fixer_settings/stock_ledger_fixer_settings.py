import frappe
from frappe.model.document import Document

class StockLedgerFixerSettings(Document):
	def validate(self):
		if self.max_auto_resolve_attempts and self.max_auto_resolve_attempts < 1:
			frappe.throw("Max Auto Resolve Attempts must be at least 1")
		if self.max_auto_resolve_attempts and self.max_auto_resolve_attempts > 10:
			frappe.throw("Max Auto Resolve Attempts cannot exceed 10 for safety")
