# Copyright (c) 2025, rsvasanth and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class StockLedgerFixerSettings(Document):
	def validate(self):
		"""Validate settings before save"""
		
		# Validate notification recipients
		if self.send_email_notifications and self.notification_recipients:
			emails = [email.strip() for email in self.notification_recipients.split(',')]
			for email in emails:
				if email and not frappe.utils.validate_email_address(email):
					frappe.throw(f"Invalid email address: {email}")
		
		# Validate batch size
		if self.batch_size_for_bulk_operations < 1:
			frappe.throw("Batch size must be at least 1")
		
		if self.batch_size_for_bulk_operations > 1000:
			frappe.throw("Batch size should not exceed 1000 to avoid performance issues")
		
		# Validate timeout
		if self.timeout_seconds < 30:
			frappe.throw("Timeout should be at least 30 seconds")
		
		# Validate scan range
		if self.enable_scheduled_scan and self.scan_date_range_days < 1:
			frappe.throw("Scan date range must be at least 1 day")


def get_settings():
	"""Get Stock Ledger Fixer Settings"""
	
	settings = frappe.get_single("Stock Ledger Fixer Settings")
	return settings


def is_auto_detection_enabled():
	"""Check if auto detection is enabled"""
	
	settings = get_settings()
	return settings.enable_auto_detection


def should_auto_create_issues():
	"""Check if auto issue creation is enabled"""
	
	settings = get_settings()
	return settings.auto_create_issues and settings.enable_auto_detection


def get_detection_delay():
	"""Get detection delay in seconds"""
	
	settings = get_settings()
	return settings.detection_delay_seconds or 5


def should_use_erpnext_reposting():
	"""Check if ERPNext reposting should be used"""
	
	settings = get_settings()
	return settings.use_erpnext_reposting


def get_batch_size():
	"""Get batch size for bulk operations"""
	
	settings = get_settings()
	return settings.batch_size_for_bulk_operations or 50


def get_timeout():
	"""Get timeout for operations"""
	
	settings = get_settings()
	return settings.timeout_seconds or 300


def should_log_all_validations():
	"""Check if all validations should be logged"""
	
	settings = get_settings()
	return settings.log_all_validations


def get_notification_settings():
	"""Get notification settings"""
	
	settings = get_settings()
	
	if not settings.send_email_notifications:
		return None
	
	recipients = []
	if settings.notification_recipients:
		recipients = [email.strip() for email in settings.notification_recipients.split(',')]
	
	return {
		'enabled': True,
		'recipients': recipients,
		'frequency': settings.notification_frequency or 'Immediate',
		'template': settings.email_template
	}


def get_scheduled_scan_settings():
	"""Get scheduled scan settings"""
	
	settings = get_settings()
	
	if not settings.enable_scheduled_scan:
		return None
	
	return {
		'enabled': True,
		'frequency': settings.scan_frequency or 'Daily',
		'time': settings.scan_time or '02:00:00',
		'date_range_days': settings.scan_date_range_days or 7
	}


def get_reposting_settings():
	"""Get reposting integration settings"""
	
	settings = get_settings()
	
	return {
		'use_erpnext_reposting': settings.use_erpnext_reposting,
		'auto_create_repost_entries': settings.auto_create_repost_entries,
		'based_on': settings.reposting_based_on_option or 'Voucher No',
		'include_future_entries': settings.include_future_entries
	}


@frappe.whitelist()
def create_default_settings():
	"""Create default settings if they don't exist"""
	
	if not frappe.db.exists("Stock Ledger Fixer Settings", "Stock Ledger Fixer Settings"):
		settings = frappe.get_doc({
			"doctype": "Stock Ledger Fixer Settings",
			"enable_auto_detection": 0,
			"auto_create_issues": 0,
			"detection_delay_seconds": 5,
			"max_issues_per_day": 100,
			"send_email_notifications": 0,
			"notification_frequency": "Immediate",
			"enable_scheduled_scan": 0,
			"scan_frequency": "Daily",
			"scan_time": "02:00:00",
			"scan_date_range_days": 7,
			"log_all_validations": 1,
			"delete_old_logs_after_days": 90,
			"batch_size_for_bulk_operations": 50,
			"timeout_seconds": 300,
			"use_erpnext_reposting": 1,
			"auto_create_repost_entries": 0,
			"reposting_based_on_option": "Voucher No",
			"include_future_entries": 1
		})
		
		settings.insert(ignore_permissions=True)
		frappe.db.commit()
		
		return settings
	
	return frappe.get_single("Stock Ledger Fixer Settings")
