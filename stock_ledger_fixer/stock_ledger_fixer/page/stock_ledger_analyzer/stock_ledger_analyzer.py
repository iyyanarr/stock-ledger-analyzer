import frappe

@frappe.whitelist()
def get_summary():
	"""Get a quick summary of stock ledger issues - Focus on Problems Only"""
	try:
		# Scenario 1: No Ledger Entry at All (Complete Missing SLE)
		missing_sle = frappe.db.sql("""
			SELECT COUNT(*) as count 
			FROM `tabStock Entry` se 
			WHERE se.docstatus = 1 
			AND se.name NOT IN (
				SELECT DISTINCT voucher_no 
				FROM `tabStock Ledger Entry` 
				WHERE voucher_type = 'Stock Entry' AND voucher_no IS NOT NULL
			)
		""", as_dict=True)
		
		# Total submitted stock entries
		total_entries = frappe.db.sql("""
			SELECT COUNT(*) as count 
			FROM `tabStock Entry` 
			WHERE docstatus = 1
		""", as_dict=True)
		
		missing_count = missing_sle[0]['count'] if missing_sle else 0
		total_count = total_entries[0]['count'] if total_entries else 0
		
		return {
			"total_entries": total_count,
			"missing_sle": missing_count,
			"summary": f"Found {missing_count} entries with no SLE out of {total_count} total entries"
		}
		
	except Exception as e:
		frappe.log_error(f"Error in get_summary: {str(e)}")
		return {"total_entries": 0, "missing_sle": 0}

@frappe.whitelist()
def analyze_stock_entries(filters):
	"""Analyze stock entries for TWO Problem Scenarios Only"""
	try:
		# Convert filters if they come as JSON string
		if isinstance(filters, str):
			import json
			filters = json.loads(filters)
		
		# Build filter conditions
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
		
		if filters.get('warehouse'):
			# Add warehouse filter - check if stock entry involves this warehouse
			conditions.append("""(EXISTS (
				SELECT 1 FROM `tabStock Entry Detail` sed 
				WHERE sed.parent = se.name 
				AND (sed.s_warehouse = %s OR sed.t_warehouse = %s)
			))""")
			values.extend([filters['warehouse'], filters['warehouse']])
		
		where_clause = " AND ".join(conditions)
		
		# First, get entries that potentially have SLE issues (be more specific)
		problematic_candidates = frappe.db.sql(f"""
			SELECT se.name, se.posting_date, se.stock_entry_type, se.company,
			       (SELECT COUNT(*) FROM `tabStock Entry Detail` sed 
			        WHERE sed.parent = se.name 
			        AND (sed.s_warehouse IS NOT NULL OR sed.t_warehouse IS NOT NULL)) as expected_sle,
			       (SELECT COUNT(*) FROM `tabStock Ledger Entry` sle 
			        WHERE sle.voucher_no = se.name AND sle.voucher_type = 'Stock Entry') as actual_sle
			FROM `tabStock Entry` se
			WHERE {where_clause}
			AND se.stock_entry_type IN ('Material Transfer', 'Material Issue', 'Material Receipt', 'Repack', 'Manufacture')
			AND EXISTS (
				SELECT 1 FROM `tabStock Entry Detail` sed 
				WHERE sed.parent = se.name 
				AND (sed.s_warehouse IS NOT NULL OR sed.t_warehouse IS NOT NULL)
			)
			HAVING expected_sle > actual_sle
			ORDER BY (expected_sle - actual_sle) DESC, se.posting_date DESC
			LIMIT 500
		""", values, as_dict=True)
		
		# Analyze each entry for the TWO problematic scenarios only
		scenario_1_missing = []  # No SLE at all
		scenario_2_partial = []  # Partial SLE
		
		for entry in problematic_candidates:
			# Get stock entry details with warehouse info for display purposes
			se_details = frappe.db.sql("""
				SELECT item_code, s_warehouse, t_warehouse, qty 
				FROM `tabStock Entry Detail` 
				WHERE parent = %s
				AND (s_warehouse IS NOT NULL OR t_warehouse IS NOT NULL)
			""", (entry.name,), as_dict=True)
			
			# Use the pre-calculated values from the query
			expected_sle = entry.expected_sle
			actual_sle = entry.actual_sle
			
			# Build warehouse movements list for display
			warehouse_movements = []
			for detail in se_details:
				if detail.s_warehouse and detail.t_warehouse:
					warehouse_movements.append(f"{detail.item_code}: {detail.s_warehouse} → {detail.t_warehouse}")
				elif detail.s_warehouse:
					warehouse_movements.append(f"{detail.item_code} OUT from {detail.s_warehouse}")
				elif detail.t_warehouse:
					warehouse_movements.append(f"{detail.item_code} IN to {detail.t_warehouse}")
			
			# Create entry data
			entry_data = {
				"name": entry.name,
				"posting_date": str(entry.posting_date),
				"stock_entry_type": entry.stock_entry_type,
				"company": entry.company,
				"expected_sle": expected_sle,
				"actual_sle": actual_sle,
				"item_count": len(se_details),
				"movements": warehouse_movements[:3]  # Show first 3 movements
			}
			
			if actual_sle == 0:
				# Scenario 1: No Ledger Entry at All
				entry_data["issue_type"] = "No SLE Created"
				entry_data["issue_details"] = f"Expected {expected_sle} SLE records but found 0"
				scenario_1_missing.append(entry_data)
			else:
				# Scenario 2: Partial Ledger Entry (since we filtered for expected_sle > actual_sle)
				entry_data["issue_type"] = "Partial SLE"
				entry_data["issue_details"] = f"Expected {expected_sle} SLE records but found only {actual_sle} (missing {expected_sle - actual_sle})"
				scenario_2_partial.append(entry_data)
		
		# Return only problematic entries
		problematic_entries = scenario_1_missing + scenario_2_partial
		
		return {
			"total_analyzed": len(problematic_candidates),
			"scenario_1_missing": len(scenario_1_missing),
			"scenario_2_partial": len(scenario_2_partial), 
			"total_problematic": len(problematic_entries),
			"problematic_entries": problematic_entries,
			"summary": f"Found {len(problematic_entries)} problematic entries out of {len(problematic_candidates)} analyzed",
			"filters_applied": filters  # For debugging
		}
		
	except Exception as e:
		return {
			"total_analyzed": 0,
			"scenario_1_missing": 0,
			"scenario_2_partial": 0,
			"total_problematic": 0,
			"problematic_entries": [],
			"error": str(e)
		}