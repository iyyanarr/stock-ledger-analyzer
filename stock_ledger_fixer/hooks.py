app_name = "stock_ledger_fixer"
app_title = "Stock Ledger Fixer"
app_publisher = "rsvasanth"
app_description = "Stock ledger fixer"
app_email = "rsvasanth@gmail.com"
app_license = "mit"

# Apps
# ------------------

# required_apps = []

# Each item in the list will be shown as an app in the apps page
# add_to_apps_screen = [
# 	{
# 		"name": "stock_ledger_fixer",
# 		"logo": "/assets/stock_ledger_fixer/logo.png",
# 		"title": "Stock Ledger Fixer",
# 		"route": "/stock_ledger_fixer",
# 		"has_permission": "stock_ledger_fixer.api.permission.has_app_permission"
# 	}
# ]

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# app_include_css = "/assets/stock_ledger_fixer/css/stock_ledger_fixer.css"
# app_include_js = "/assets/stock_ledger_fixer/js/stock_ledger_fixer.js"

# include js, css files in header of web template
# web_include_css = "/assets/stock_ledger_fixer/css/stock_ledger_fixer.css"
# web_include_js = "/assets/stock_ledger_fixer/js/stock_ledger_fixer.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "stock_ledger_fixer/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
page_js = {"stock-ledger-analyzer" : "public/js/stock_ledger_analyzer.js"}

# Document Events
# ---------------

# DISABLED: the automatic on-submit validation is non-functional and expensive.
#
# hooks.delayed_validation (stock_ledger_fixer/hooks.py) opens with
#     from stock_ledger_fixer.stock_ledger_fixer.utils import StockLedgerValidator
# and that module does not exist anywhere in this app — so the import raises
# ImportError on EVERY Stock Entry, the validator has never once run, and the
# except-branch re-enqueues itself three times with progressive in-worker
# time.sleep() calls before giving up:
#
#     initial  sleep 10s  -> ImportError -> retry
#     retry 1  sleep 35s  -> ImportError -> retry
#     retry 2  sleep 70s  -> ImportError -> retry
#     retry 3  sleep 105s -> ImportError -> log "Failed to validate ... after 3 retries"
#
# i.e. 4 short-queue jobs and ~220s of BLOCKED worker time per Stock Entry, for
# no result. time.sleep() inside a worker holds the queue slot, so this
# saturates the short queue on a busy site.
#
# Measured on the SPP production site (spp15), 2026-08-06:
#     319 such failures today   = 44% of all 733 error logs
#   3,995 over the last 7 days  = 49% of all 8,232 error logs
#   ~1,276 wasted background jobs/day
#   Stock Ledger Issue / Stock Entry Issue doctypes do not exist -> zero output
#
# The rest of the app is UNAFFECTED and still works: detection.py, fixer.py and
# the "Stock Ledger Analyzer" page carry no dependency on the missing module, so
# on-demand analysis is unchanged. Only the automatic hook is disabled.
#
# To re-enable, first implement stock_ledger_fixer/stock_ledger_fixer/utils.py
# with a StockLedgerValidator class, and reconsider the retry design — sleeping
# in a worker should be replaced with frappe.enqueue_after_commit / a scheduled
# job so queue slots are not held.
#
# doc_events = {
#     "Stock Entry": {
#         "on_submit": "stock_ledger_fixer.stock_ledger_fixer.hooks.validate_stock_entry_on_submit",
#         "after_insert": "stock_ledger_fixer.stock_ledger_fixer.hooks.schedule_stock_entry_validation"
#     }
# }

# Scheduled Tasks
# ---------------
# Commented out until tasks module is implemented
# scheduler_events = {
#     "cron": {
#         # Run stock ledger validation every hour
#         "0 * * * *": [
#             "stock_ledger_fixer.stock_ledger_fixer.tasks.validate_recent_stock_entries"
#         ],
#         # Run comprehensive analysis daily at 2 AM
#         "0 2 * * *": [
#             "stock_ledger_fixer.stock_ledger_fixer.tasks.daily_stock_ledger_analysis"
#         ]
#     }
# }

# Svg Icons
# ------------------
# include app icons in desk
# app_include_icons = "stock_ledger_fixer/public/icons.svg"

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# Jinja
# ----------

# add methods and filters to jinja environment
# jinja = {
# 	"methods": "stock_ledger_fixer.utils.jinja_methods",
# 	"filters": "stock_ledger_fixer.utils.jinja_filters"
# }

# Installation
# ------------

# before_install = "stock_ledger_fixer.install.before_install"
# after_install = "stock_ledger_fixer.install.after_install"

# Uninstallation
# ------------

# before_uninstall = "stock_ledger_fixer.uninstall.before_uninstall"
# after_uninstall = "stock_ledger_fixer.uninstall.after_uninstall"

# Integration Setup
# ------------------
# To set up dependencies/integrations with other apps
# Name of the app being installed is passed as an argument

# before_app_install = "stock_ledger_fixer.utils.before_app_install"
# after_app_install = "stock_ledger_fixer.utils.after_app_install"

# Integration Cleanup
# -------------------
# To clean up dependencies/integrations with other apps
# Name of the app being uninstalled is passed as an argument

# before_app_uninstall = "stock_ledger_fixer.utils.before_app_uninstall"
# after_app_uninstall = "stock_ledger_fixer.utils.after_app_uninstall"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "stock_ledger_fixer.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# DocType Class
# ---------------
# Override standard doctype classes

# override_doctype_class = {
# 	"ToDo": "custom_app.overrides.CustomToDo"
# }

# Document Events
# ---------------
# Hook on document methods and events

# doc_events = {
# 	"*": {
# 		"on_update": "method",
# 		"on_cancel": "method",
# 		"on_trash": "method"
# 	}
# }

# Scheduled Tasks
# ---------------

# scheduler_events = {
# 	"all": [
# 		"stock_ledger_fixer.tasks.all"
# 	],
# 	"daily": [
# 		"stock_ledger_fixer.tasks.daily"
# 	],
# 	"hourly": [
# 		"stock_ledger_fixer.tasks.hourly"
# 	],
# 	"weekly": [
# 		"stock_ledger_fixer.tasks.weekly"
# 	],
# 	"monthly": [
# 		"stock_ledger_fixer.tasks.monthly"
# 	],
# }

# Testing
# -------

# before_tests = "stock_ledger_fixer.install.before_tests"

# Overriding Methods
# ------------------------------
#
# override_whitelisted_methods = {
# 	"frappe.desk.doctype.event.event.get_events": "stock_ledger_fixer.event.get_events"
# }
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "stock_ledger_fixer.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# Ignore links to specified DocTypes when deleting documents
# -----------------------------------------------------------

# ignore_links_on_delete = ["Communication", "ToDo"]

# Request Events
# ----------------
# before_request = ["stock_ledger_fixer.utils.before_request"]
# after_request = ["stock_ledger_fixer.utils.after_request"]

# Job Events
# ----------
# before_job = ["stock_ledger_fixer.utils.before_job"]
# after_job = ["stock_ledger_fixer.utils.after_job"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"stock_ledger_fixer.auth.validate"
# ]

# Automatically update python controller files with type annotations for this app.
# export_python_type_annotations = True

# default_log_clearing_doctypes = {
# 	"Logging DocType Name": 30  # days to retain logs
# }

