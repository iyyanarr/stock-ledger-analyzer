import frappe

@frappe.whitelist()
def analyze_specific_stock_entry(stock_entry_name):
	"""Analyze a specific stock entry for issues"""
	try:
		# Get the stock entry document
		stock_entry = frappe.get_doc("Stock Entry", stock_entry_name)
		
		# Get stock entry details
		se_details = stock_entry.items
		se_details_count = len(se_details)
		
		# Get related stock ledger entries
		sle_entries = frappe.get_all(
			"Stock Ledger Entry",
			filters={
				"voucher_no": stock_entry_name,
				"voucher_type": "Stock Entry"
			},
			fields=["name", "item_code", "warehouse", "actual_qty"]
		)
		
		sle_count = len(sle_entries)
		
		# Calculate expected SLE count based on warehouse movements
		expected_sle_count = 0
		for item in se_details:
			if item.s_warehouse:  # Source warehouse
				expected_sle_count += 1
			if item.t_warehouse:  # Target warehouse
				expected_sle_count += 1
		
		# Determine if there are issues
		issues_found = 0
		if sle_count == 0 and expected_sle_count > 0:
			issues_found = 1
		elif sle_count < expected_sle_count:
			issues_found = 1
		
		return {
			"success": True,
			"stock_entry": stock_entry_name,
			"se_details_count": se_details_count,
			"sle_count": sle_count,
			"expected_sle_count": expected_sle_count,
			"issues_found": issues_found,
			"stock_entry_type": stock_entry.stock_entry_type
		}
		
	except Exception as e:
		return {
			"success": False,
			"error": str(e)
		}

def get_problematic_stock_entries(limit=100):
	"""Get stock entries that have missing or incomplete stock ledger entries"""
	try:
		# Get all stock entries and check them
		stock_entries = frappe.db.sql("""
			SELECT 
				se.name,
				se.posting_date,
				se.stock_entry_type
			FROM `tabStock Entry` se
			WHERE se.docstatus = 1
			ORDER BY se.posting_date DESC
			LIMIT %s
		""", (limit,), as_dict=True)
		
		problematic_entries = []
		
		for entry in stock_entries:
			# Get items for this stock entry
			items = frappe.get_all(
				"Stock Entry Detail",
				filters={"parent": entry.name},
				fields=["s_warehouse", "t_warehouse"]
			)
			
			# Calculate expected SLE
			expected_sle = 0
			for item in items:
				if item.s_warehouse:
					expected_sle += 1
				if item.t_warehouse:
					expected_sle += 1
			
			# Get actual SLE count
			actual_sle = frappe.db.count(
				"Stock Ledger Entry",
				{
					"voucher_no": entry.name,
					"voucher_type": "Stock Entry"
				}
			)
			
			# Check if problematic
			if actual_sle == 0 and expected_sle > 0:
				problematic_entries.append({
					"name": entry.name,
					"posting_date": str(entry.posting_date),
					"issue_type": "Missing SLE",
					"missing_items": f"{len(items)} items, 0 SLE (expected: {expected_sle})",
					"stock_entry_type": entry.stock_entry_type
				})
			elif actual_sle < expected_sle:
				problematic_entries.append({
					"name": entry.name,
					"posting_date": str(entry.posting_date),
					"issue_type": "Incomplete SLE",
					"missing_items": f"{len(items)} items, {actual_sle} SLE (expected: {expected_sle})",
					"stock_entry_type": entry.stock_entry_type
				})
		
		return problematic_entries
		
	except Exception as e:
		frappe.log_error(f"Error getting problematic entries: {str(e)}")
		return []

def analyze_stock_entries_with_filters(filters):
	"""Analyze stock entries with given filters"""
	try:
		# Build conditions
		conditions = ["se.docstatus = 1"]
		values = []
		
		if filters.get('from_date'):
			conditions.append("se.posting_date >= %s")
			values.append(filters['from_date'])
		
		if filters.get('to_date'):
			conditions.append("se.posting_date <= %s")
			values.append(filters['to_date'])
		
		if filters.get('company'):
			conditions.append("se.company = %s")
			values.append(filters['company'])
		
		where_clause = " AND ".join(conditions)
		
		# Get stock entries
		stock_entries = frappe.db.sql(f"""
			SELECT name, posting_date, stock_entry_type
			FROM `tabStock Entry` se
			WHERE {where_clause}
			ORDER BY posting_date DESC
		""", values, as_dict=True)
		
		# Analyze each entry
		total_stock_entries = len(stock_entries)
		missing_sle_count = 0
		incomplete_sle_count = 0
		valid_entries = 0
		problematic_entries = []
		
		for entry in stock_entries:
			# Get items
			items = frappe.get_all(
				"Stock Entry Detail",
				filters={"parent": entry.name},
				fields=["s_warehouse", "t_warehouse"]
			)
			
			# Calculate expected SLE
			expected_sle = 0
			for item in items:
				if item.s_warehouse:
					expected_sle += 1
				if item.t_warehouse:
					expected_sle += 1
			
			# Get actual SLE
			actual_sle = frappe.db.count(
				"Stock Ledger Entry",
				{
					"voucher_no": entry.name,
					"voucher_type": "Stock Entry"
				}
			)
			
			# Categorize
			if actual_sle == 0 and expected_sle > 0:
				missing_sle_count += 1
				problematic_entries.append({
					"name": entry.name,
					"posting_date": str(entry.posting_date),
					"issue_type": "Missing SLE",
					"missing_items": f"{len(items)} items, 0 SLE (expected: {expected_sle})",
					"stock_entry_type": entry.stock_entry_type
				})
			elif actual_sle < expected_sle:
				incomplete_sle_count += 1
				problematic_entries.append({
					"name": entry.name,
					"posting_date": str(entry.posting_date),
					"issue_type": "Incomplete SLE",
					"missing_items": f"{len(items)} items, {actual_sle} SLE (expected: {expected_sle})",
					"stock_entry_type": entry.stock_entry_type
				})
			else:
				valid_entries += 1
		
		return {
			"total_stock_entries": total_stock_entries,
			"missing_sle_count": missing_sle_count,
			"incomplete_sle_count": incomplete_sle_count,
			"valid_entries": valid_entries,
			"problematic_entries": problematic_entries
		}
		
	except Exception as e:
		return {
			"total_stock_entries": 0,
			"missing_sle_count": 0,
			"incomplete_sle_count": 0,
			"valid_entries": 0,
			"problematic_entries": [],
			"error": str(e)
		}
