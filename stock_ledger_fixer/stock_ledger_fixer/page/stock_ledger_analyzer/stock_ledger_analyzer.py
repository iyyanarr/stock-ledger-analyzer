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

import frappe

@frappe.whitelist()
def bulk_create_missing_sles(filters, selected_entries=None):
	"""
	Bulk create missing Stock Ledger Entries for problematic stock entries
	Allows date range selection and specific entry selection
	"""
	try:
		# Convert filters if they come as JSON string
		if isinstance(filters, str):
			import json
			filters = json.loads(filters)
		
		if isinstance(selected_entries, str):
			import json
			selected_entries = json.loads(selected_entries) if selected_entries else None
		
		# Build filter conditions for date range
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
		
		# If specific entries are selected, use those
		if selected_entries and len(selected_entries) > 0:
			placeholders = ', '.join(['%s'] * len(selected_entries))
			conditions.append(f"se.name IN ({placeholders})")
			values.extend(selected_entries)
		
		where_clause = " AND ".join(conditions)
		
		# Find stock entries with missing SLE items
		query = f"""
			SELECT 
				se.name as stock_entry,
				se.posting_date,
				se.posting_time,
				se.company,
				sed.name as detail_name,
				sed.item_code,
				sed.s_warehouse,
				sed.t_warehouse,
				sed.qty,
				sed.transfer_qty,
				sed.serial_and_batch_bundle,
				sed.basic_rate,
				sed.idx
			FROM `tabStock Entry` se
			INNER JOIN `tabStock Entry Detail` sed ON sed.parent = se.name
			LEFT JOIN `tabStock Ledger Entry` sle ON (
				sle.voucher_no = se.name 
				AND sle.voucher_detail_no = sed.name
				AND sle.is_cancelled = 0
			)
			WHERE {where_clause}
			AND sle.name IS NULL
			AND (sed.s_warehouse IS NOT NULL OR sed.t_warehouse IS NOT NULL)
			ORDER BY se.posting_date, se.name, sed.idx
		"""
		
		missing_sle_data = frappe.db.sql(query, values, as_dict=True)
		
		if not missing_sle_data:
			return {
				"success": True,
				"message": "No missing SLE entries found in the selected range",
				"created_count": 0
			}
		
		# Create missing SLEs
		created_count = 0
		errors = []
		
		for row in missing_sle_data:
			try:
				# Create SLE for source warehouse (outward)
				if row.s_warehouse:
					sle_name = create_stock_ledger_entry(
						item_code=row.item_code,
						warehouse=row.s_warehouse,
						posting_date=row.posting_date,
						posting_time=row.posting_time,
						voucher_type='Stock Entry',
						voucher_no=row.stock_entry,
						voucher_detail_no=row.detail_name,
						actual_qty=-abs(float(row.transfer_qty or row.qty)),  # Always negative for outward
						serial_and_batch_bundle=row.serial_and_batch_bundle,
						company=row.company
					)
					if sle_name:
						created_count += 1
				
				# Create SLE for target warehouse (inward)
				if row.t_warehouse:
					sle_name = create_stock_ledger_entry(
						item_code=row.item_code,
						warehouse=row.t_warehouse,
						posting_date=row.posting_date,
						posting_time=row.posting_time,
						voucher_type='Stock Entry',
						voucher_no=row.stock_entry,
						voucher_detail_no=row.detail_name,
						actual_qty=abs(float(row.transfer_qty or row.qty)),  # Always positive for inward
						serial_and_batch_bundle=row.serial_and_batch_bundle,
						company=row.company,
						incoming_rate=float(row.basic_rate or 0)
					)
					if sle_name:
						created_count += 1
						
			except Exception as e:
				error_msg = f"Error creating SLE for {row.stock_entry} - {row.item_code}: {str(e)}"
				errors.append(error_msg)
				frappe.log_error(error_msg, "Bulk SLE Creation Error")
		
		# Commit the changes
		frappe.db.commit()
		
		result = {
			"success": True,
			"created_count": created_count,
			"total_missing": len(missing_sle_data),
			"message": f"Successfully created {created_count} missing SLE entries"
		}
		
		if errors:
			result["errors"] = errors
			result["message"] += f" with {len(errors)} errors"
		
		return result
		
	except Exception as e:
		frappe.log_error(f"Error in bulk_create_missing_sles: {str(e)}")
		return {
			"success": False,
			"message": f"Error occurred: {str(e)}",
			"created_count": 0
		}

def create_stock_ledger_entry(item_code, warehouse, posting_date, posting_time, 
							voucher_type, voucher_no, voucher_detail_no, actual_qty,
							serial_and_batch_bundle=None, company=None, incoming_rate=0):
	"""Create a single Stock Ledger Entry"""
	try:
		# Get item details
		item_details = frappe.get_cached_value('Item', item_code, ['stock_uom', 'has_batch_no', 'has_serial_no'], as_dict=True)
		
		# Create SLE document
		sle = frappe.new_doc('Stock Ledger Entry')
		sle.update({
			'item_code': item_code,
			'warehouse': warehouse,
			'posting_date': posting_date,
			'posting_time': posting_time,
			'voucher_type': voucher_type,
			'voucher_no': voucher_no,
			'voucher_detail_no': voucher_detail_no,
			'actual_qty': actual_qty,
			'incoming_rate': incoming_rate,
			'outgoing_rate': 0,
			'stock_uom': item_details.get('stock_uom', 'Nos'),
			'company': company,
			'is_cancelled': 0,
			'fiscal_year': get_fiscal_year(posting_date)[0],
			'serial_and_batch_bundle': serial_and_batch_bundle,
			'has_batch_no': item_details.get('has_batch_no', 0),
			'has_serial_no': item_details.get('has_serial_no', 0)
		})
		
		# Insert and submit
		sle.insert(ignore_permissions=True)
		sle.submit()
		
		return sle.name
		
	except Exception as e:
		frappe.log_error(f"Error creating SLE: {str(e)}")
		return None

def get_fiscal_year(date):
	"""Get fiscal year for a date"""
	try:
		return frappe.db.get_value('Fiscal Year', 
			{'year_start_date': ['<=', date], 'year_end_date': ['>=', date]}, 
			['name', 'year_start_date', 'year_end_date']) or ['25-26', None, None]
	except:
		return ['25-26', None, None]

@frappe.whitelist()
def get_problematic_entries_summary(filters):
	"""Get a summary of problematic entries in date range for selection"""
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
		
		where_clause = " AND ".join(conditions)
		
		# Find entries with missing SLEs
		query = f"""
			SELECT 
				se.name,
				se.posting_date,
				se.stock_entry_type,
				COUNT(sed.name) as total_items,
				COUNT(CASE WHEN sle.name IS NULL THEN 1 END) as missing_sle_items,
				CASE 
					WHEN COUNT(sle.name) = 0 THEN 'No SLE Created'
					WHEN COUNT(sle.name) < COUNT(sed.name) THEN 'Partial SLE'
					ELSE 'Complete'
				END as issue_type
			FROM `tabStock Entry` se
			INNER JOIN `tabStock Entry Detail` sed ON sed.parent = se.name
			LEFT JOIN `tabStock Ledger Entry` sle ON (
				sle.voucher_no = se.name 
				AND sle.voucher_detail_no = sed.name
				AND sle.is_cancelled = 0
			)
			WHERE {where_clause}
			AND (sed.s_warehouse IS NOT NULL OR sed.t_warehouse IS NOT NULL)
			GROUP BY se.name
			HAVING missing_sle_items > 0
			ORDER BY se.posting_date DESC, se.name
		"""
		
		result = frappe.db.sql(query, values, as_dict=True)
		
		return {
			"success": True,
			"entries": result,
			"total_problematic": len(result)
		}
		
	except Exception as e:
		frappe.log_error(f"Error in get_problematic_entries_summary: {str(e)}")
		return {
			"success": False,
			"message": f"Error occurred: {str(e)}",
			"entries": []
		}

