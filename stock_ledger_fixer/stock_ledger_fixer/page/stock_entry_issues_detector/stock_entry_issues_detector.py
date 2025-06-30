import frappe
from frappe import _
from frappe.utils import getdate, get_datetime, flt, cint
import json

@frappe.whitelist()
def get_stock_entries_with_missing_sles(from_date=None, to_date=None, stock_entry_type=None, limit=100):
    """
    Get stock entries with missing Stock Ledger Entries in the given date range
    """
    try:
        # Default date range if not provided
        if not from_date:
            from_date = frappe.utils.add_days(frappe.utils.nowdate(), -30)
        if not to_date:
            to_date = frappe.utils.nowdate()
        
        # Base query conditions
        conditions = [
            "se.docstatus = 1",
            "se.creation >= %(from_date)s",
            "se.creation <= %(to_date)s"
        ]
        
        # Add stock entry type filter if provided
        if stock_entry_type and stock_entry_type != "All":
            conditions.append("se.stock_entry_type = %(stock_entry_type)s")
        
        # Build the query
        query = f"""
        SELECT 
            se.name,
            se.creation,
            se.posting_date,
            se.stock_entry_type,
            se.purpose,
            se.company,
            se.from_warehouse,
            se.to_warehouse,
            COUNT(DISTINCT sed.name) as details_count,
            COUNT(DISTINCT sle.name) as sle_count,
            (COUNT(DISTINCT sed.name) - COUNT(DISTINCT sle.name)) as missing_sles,
            se.total_outgoing_value,
            se.total_incoming_value
        FROM `tabStock Entry` se
        LEFT JOIN `tabStock Entry Detail` sed ON se.name = sed.parent
        LEFT JOIN `tabStock Ledger Entry` sle ON se.name = sle.voucher_no
        WHERE {' AND '.join(conditions)}
        GROUP BY se.name
        HAVING missing_sles > 0
        ORDER BY missing_sles DESC, se.creation DESC
        LIMIT %(limit)s
        """
        
        # Execute query
        params = {
            'from_date': from_date + ' 00:00:00',
            'to_date': to_date + ' 23:59:59',
            'limit': cint(limit)
        }
        
        if stock_entry_type and stock_entry_type != "All":
            params['stock_entry_type'] = stock_entry_type
        
        results = frappe.db.sql(query, params, as_dict=1)
        
        # Get summary statistics
        summary = get_summary_stats(from_date, to_date, stock_entry_type)
        
        return {
            "status": "success",
            "data": results,
            "summary": summary
        }
        
    except Exception as e:
        frappe.log_error(message=frappe.get_traceback(), title="Stock Entry Issues Detector Error")
        return {
            "status": "error",
            "message": str(e)
        }

@frappe.whitelist()
def get_summary_stats(from_date, to_date, stock_entry_type=None):
    """
    Get summary statistics for the date range
    """
    try:
        conditions = [
            "se.docstatus = 1",
            "se.creation >= %(from_date)s",
            "se.creation <= %(to_date)s"
        ]
        
        if stock_entry_type and stock_entry_type != "All":
            conditions.append("se.stock_entry_type = %(stock_entry_type)s")
        
        # Total stock entries
        total_query = f"""
        SELECT COUNT(*) as total_entries
        FROM `tabStock Entry` se
        WHERE {' AND '.join(conditions)}
        """
        
        # Affected stock entries
        affected_query = f"""
        SELECT 
            COUNT(DISTINCT se.name) as affected_entries,
            SUM(COUNT(DISTINCT sed.name) - COUNT(DISTINCT sle.name)) as total_missing_sles
        FROM `tabStock Entry` se
        LEFT JOIN `tabStock Entry Detail` sed ON se.name = sed.parent
        LEFT JOIN `tabStock Ledger Entry` sle ON se.name = sle.voucher_no
        WHERE {' AND '.join(conditions)}
        GROUP BY se.name
        HAVING (COUNT(DISTINCT sed.name) - COUNT(DISTINCT sle.name)) > 0
        """
        
        # By stock entry type
        type_query = f"""
        SELECT 
            se.stock_entry_type,
            COUNT(DISTINCT se.name) as affected_count,
            SUM(COUNT(DISTINCT sed.name) - COUNT(DISTINCT sle.name)) as missing_sles
        FROM `tabStock Entry` se
        LEFT JOIN `tabStock Entry Detail` sed ON se.name = sed.parent
        LEFT JOIN `tabStock Ledger Entry` sle ON se.name = sle.voucher_no
        WHERE {' AND '.join(conditions)}
        GROUP BY se.name
        HAVING (COUNT(DISTINCT sed.name) - COUNT(DISTINCT sle.name)) > 0
        GROUP BY se.stock_entry_type
        ORDER BY affected_count DESC
        """
        
        params = {
            'from_date': from_date + ' 00:00:00',
            'to_date': to_date + ' 23:59:59'
        }
        
        if stock_entry_type and stock_entry_type != "All":
            params['stock_entry_type'] = stock_entry_type
        
        total_result = frappe.db.sql(total_query, params, as_dict=1)
        affected_result = frappe.db.sql(affected_query, params, as_dict=1)
        type_result = frappe.db.sql(type_query, params, as_dict=1)
        
        return {
            "total_entries": total_result[0].total_entries if total_result else 0,
            "affected_entries": len(affected_result) if affected_result else 0,
            "total_missing_sles": sum([r.get('total_missing_sles', 0) or 0 for r in affected_result]) if affected_result else 0,
            "by_type": type_result
        }
        
    except Exception as e:
        frappe.log_error(message=frappe.get_traceback(), title="Summary Stats Error")
        return {}

@frappe.whitelist()
def get_stock_entry_details(stock_entry_name):
    """
    Get detailed information about a specific stock entry and its missing SLEs
    """
    try:
        # Get stock entry header
        se_details = frappe.db.get_value("Stock Entry", stock_entry_name, [
            "name", "creation", "posting_date", "stock_entry_type", "purpose", 
            "company", "from_warehouse", "to_warehouse", "total_outgoing_value", 
            "total_incoming_value", "docstatus"
        ], as_dict=1)
        
        if not se_details:
            return {"status": "error", "message": "Stock Entry not found"}
        
        # Get stock entry details with SLE status
        details_query = """
        SELECT 
            sed.name,
            sed.idx,
            sed.item_code,
            sed.item_name,
            sed.s_warehouse,
            sed.t_warehouse,
            sed.qty,
            sed.basic_rate,
            sed.amount,
            sed.batch_no,
            sed.serial_no,
            sed.is_finished_item,
            sle.name as sle_name,
            sle.actual_qty,
            sle.stock_value,
            CASE 
                WHEN sle.name IS NULL THEN 'Missing'
                ELSE 'Created'
            END as sle_status
        FROM `tabStock Entry Detail` sed
        LEFT JOIN `tabStock Ledger Entry` sle ON sed.name = sle.voucher_detail_no
        WHERE sed.parent = %s
        ORDER BY sed.idx
        """
        
        item_details = frappe.db.sql(details_query, (stock_entry_name,), as_dict=1)
        
        # Get error logs related to this stock entry around the creation time
        creation_time = se_details.creation
        from_time = frappe.utils.add_to_date(creation_time, minutes=-5)
        to_time = frappe.utils.add_to_date(creation_time, minutes=5)
        
        error_logs = frappe.db.sql("""
        SELECT creation, method, error
        FROM `tabError Log`
        WHERE creation >= %s AND creation <= %s
        AND (error LIKE %s OR error LIKE %s OR error LIKE %s)
        ORDER BY creation
        """, (from_time, to_time, f"%{stock_entry_name}%", "%deadlock%", "%negative stock%"), as_dict=1)
        
        return {
            "status": "success",
            "stock_entry": se_details,
            "items": item_details,
            "error_logs": error_logs,
            "missing_count": len([item for item in item_details if item.sle_status == 'Missing']),
            "total_count": len(item_details)
        }
        
    except Exception as e:
        frappe.log_error(message=frappe.get_traceback(), title="Stock Entry Details Error")
        return {"status": "error", "message": str(e)}

@frappe.whitelist()
def fix_missing_sles(stock_entry_name):
    """
    Fix missing Stock Ledger Entries for a stock entry by addressing both missing SLEs 
    and Serial and Batch Bundle inconsistencies
    """
    try:
        # Get the stock entry
        stock_entry = frappe.get_doc("Stock Entry", stock_entry_name)
        
        if stock_entry.docstatus != 1:
            return {"status": "error", "message": "Stock Entry is not submitted"}
        
        # Count existing SLEs
        existing_sle_count = frappe.db.count("Stock Ledger Entry", {"voucher_no": stock_entry_name})
        expected_sle_count = len(stock_entry.items)
        
        # Check for bundle inconsistencies even if SLEs are present
        bundle_fix_result = fix_serial_batch_bundles(stock_entry)
        has_bundle_issues = bundle_fix_result.get("fixed_bundles", 0) > 0
        
        if existing_sle_count == expected_sle_count and not has_bundle_issues:
            return {"status": "success", "message": "No missing SLEs or bundle issues found"}
        
        frappe.log_error(
            message=f"Fixing SLEs for {stock_entry_name}. Expected: {expected_sle_count}, Found: {existing_sle_count}, Bundle fixes: {bundle_fix_result.get('fixed_bundles', 0)}",
            title="SLE Fix Started"
        )
        
        # If we only had bundle issues and no missing SLEs, we might not need to recreate SLEs
        if existing_sle_count == expected_sle_count and has_bundle_issues:
            # Only bundle fixes were needed, SLEs are already present
            return {
                "status": "success", 
                "message": f"Fixed {bundle_fix_result['fixed_bundles']} bundle inconsistencies. SLEs were already present."
            }
        
        # Store original dates to preserve them during resubmission
        original_posting_date = stock_entry.posting_date
        original_posting_time = stock_entry.posting_time
        
        # Step 1: We already fixed bundles above
        
        # Step 2: Clear any orphaned Stock Ledger Entries BEFORE cancelling
        frappe.db.sql("""
            DELETE FROM `tabStock Ledger Entry` 
            WHERE voucher_no = %s
        """, (stock_entry_name,))
        
        # Step 3: Reset docstatus to draft and resubmit
        # This approach avoids triggering validation errors during cancel
        frappe.db.sql("""
            UPDATE `tabStock Entry` 
            SET docstatus = 0 
            WHERE name = %s
        """, (stock_entry_name,))
        
        # Reload the document to get fresh state
        stock_entry.reload()
        
        # Step 4: Preserve original posting date and time before resubmission
        stock_entry.posting_date = original_posting_date
        stock_entry.posting_time = original_posting_time
        
        # Submit again to regenerate SLEs with corrected bundles
        stock_entry.docstatus = 1
        stock_entry.save(ignore_permissions=True)
        
        # Verify fix
        new_sle_count = frappe.db.count("Stock Ledger Entry", {"voucher_no": stock_entry_name})
        
        if new_sle_count == expected_sle_count:
            message = f"Fixed! Created {new_sle_count} SLEs"
            if bundle_fix_result.get("fixed_bundles"):
                message += f" and fixed {bundle_fix_result['fixed_bundles']} bundle inconsistencies"
            return {"status": "success", "message": message}
        else:
            return {"status": "error", "message": f"Fix failed. Expected: {expected_sle_count}, Got: {new_sle_count}"}
            
    except Exception as e:
        frappe.log_error(message=frappe.get_traceback(), title="SLE Fix Error")
        return {"status": "error", "message": str(e)}

def fix_serial_batch_bundles(stock_entry):
    """
    Fix Serial and Batch Bundle inconsistencies where transaction type doesn't match actual qty
    """
    fixed_bundles = 0
    
    try:
        for item in stock_entry.items:
            if item.serial_and_batch_bundle:
                # Get the bundle
                bundle_doc = frappe.get_doc("Serial and Batch Bundle", item.serial_and_batch_bundle)
                
                # Determine correct transaction type based on warehouse context
                # If item has source warehouse, it's an outward transaction from that warehouse
                # If item has target warehouse, it's an inward transaction to that warehouse
                if item.s_warehouse:
                    correct_type = "Outward"  # Moving out of source warehouse
                elif item.t_warehouse:
                    correct_type = "Inward"   # Moving into target warehouse
                else:
                    # Fallback to quantity-based logic for other cases
                    correct_type = "Outward" if flt(item.qty) < 0 else "Inward"
                
                # Fix if inconsistent
                if bundle_doc.type_of_transaction != correct_type:
                    frappe.log_error(
                        message=f"Fixing bundle {bundle_doc.name}: changing from {bundle_doc.type_of_transaction} to {correct_type} for item {item.item_code} (s_warehouse: {item.s_warehouse}, t_warehouse: {item.t_warehouse}, qty: {item.qty})",
                        title="Bundle Type Fix"
                    )
                    
                    # Update bundle type directly in database to avoid validation
                    frappe.db.sql("""
                        UPDATE `tabSerial and Batch Bundle`
                        SET type_of_transaction = %s
                        WHERE name = %s
                    """, (correct_type, bundle_doc.name))
                    
                    # Update all entries in the bundle - only update is_outward field
                    is_outward = 1 if correct_type == "Outward" else 0
                    frappe.db.sql("""
                        UPDATE `tabSerial and Batch Entry`
                        SET is_outward = %s
                        WHERE parent = %s
                    """, (is_outward, bundle_doc.name))
                    

                    
                    fixed_bundles += 1
        
        # Commit the changes
        frappe.db.commit()
        
        return {"fixed_bundles": fixed_bundles}
        
    except Exception as e:
        # Rollback on error
        frappe.db.rollback()
        frappe.log_error(message=frappe.get_traceback(), title="Bundle Fix Error")
        return {"fixed_bundles": 0, "error": str(e)}

@frappe.whitelist()
def diagnose_stock_entry_issues(stock_entry_name):
    """
    Diagnose specific issues with a stock entry to provide detailed fix recommendations
    """
    try:
        # Get stock entry details
        stock_entry = frappe.get_doc("Stock Entry", stock_entry_name)
        
        issues = []
        
        # Check 1: Missing SLEs
        existing_sle_count = frappe.db.count("Stock Ledger Entry", {"voucher_no": stock_entry_name})
        expected_sle_count = len(stock_entry.items)
        
        if existing_sle_count < expected_sle_count:
            issues.append({
                "type": "Missing SLEs",
                "severity": "High",
                "description": f"Expected {expected_sle_count} SLEs, found {existing_sle_count}",
                "fix": "Resubmit stock entry"
            })
        
        # Check 2: Serial and Batch Bundle inconsistencies
        bundle_issues = []
        for item in stock_entry.items:
            if item.serial_and_batch_bundle:
                bundle_doc = frappe.get_doc("Serial and Batch Bundle", item.serial_and_batch_bundle)
                
                # Check transaction type consistency using warehouse context
                if item.s_warehouse:
                    expected_type = "Outward"  # Moving out of source warehouse
                elif item.t_warehouse:
                    expected_type = "Inward"   # Moving into target warehouse
                else:
                    # Fallback to quantity-based logic
                    expected_type = "Outward" if flt(item.qty) < 0 else "Inward"
                if bundle_doc.type_of_transaction != expected_type:
                    bundle_issues.append({
                        "bundle": item.serial_and_batch_bundle,
                        "item": item.item_code,
                        "current_type": bundle_doc.type_of_transaction,
                        "expected_type": expected_type,
                        "qty": item.qty,
                        "s_warehouse": item.s_warehouse,
                        "t_warehouse": item.t_warehouse
                    })
        
        if bundle_issues:
            issues.append({
                "type": "Bundle Type Mismatch",
                "severity": "High",
                "description": f"Found {len(bundle_issues)} bundle type inconsistencies",
                "details": bundle_issues,
                "fix": "Correct bundle transaction types"
            })
        
        # Check 3: Negative stock issues
        negative_stock_items = []
        for item in stock_entry.items:
            if item.s_warehouse and flt(item.qty) > 0:
                # Check current stock
                current_stock = frappe.db.sql("""
                    SELECT SUM(actual_qty) as current_qty
                    FROM `tabStock Ledger Entry`
                    WHERE item_code = %s AND warehouse = %s AND batch_no = %s
                """, (item.item_code, item.s_warehouse, item.batch_no or ""), as_dict=1)
                
                if current_stock and flt(current_stock[0].current_qty) < flt(item.qty):
                    negative_stock_items.append({
                        "item": item.item_code,
                        "warehouse": item.s_warehouse,
                        "batch": item.batch_no,
                        "required_qty": item.qty,
                        "available_qty": current_stock[0].current_qty
                    })
        
        if negative_stock_items:
            issues.append({
                "type": "Insufficient Stock",
                "severity": "Medium",
                "description": f"Found {len(negative_stock_items)} items with insufficient stock",
                "details": negative_stock_items,
                "fix": "Check stock availability before processing"
            })
        
        # Check 4: Deadlock evidence in error logs
        creation_time = stock_entry.creation
        from_time = frappe.utils.add_to_date(creation_time, minutes=-10)
        to_time = frappe.utils.add_to_date(creation_time, minutes=10)
        
        # Search for deadlock errors around the stock entry creation time
        deadlock_errors = frappe.db.sql("""
        SELECT creation, method, error
        FROM `tabError Log`
        WHERE creation >= %s AND creation <= %s
        AND (error LIKE %s OR error LIKE %s OR error LIKE %s OR error LIKE %s)
        ORDER BY creation
        """, (from_time, to_time, "%deadlock%", "%Deadlock%", "%1213%", "%try restarting transaction%"), as_dict=1)
        
        # Also search for errors mentioning items/batches from this stock entry
        item_errors = []
        for item in stock_entry.items:
            if item.item_code:
                item_related_errors = frappe.db.sql("""
                SELECT creation, method, error
                FROM `tabError Log`
                WHERE creation >= %s AND creation <= %s
                AND (error LIKE %s OR error LIKE %s)
                AND (error LIKE %s OR error LIKE %s)
                ORDER BY creation
                """, (from_time, to_time, "%deadlock%", "%1213%", f"%{item.item_code}%", f"%{item.batch_no or 'NOBATCH'}%"), as_dict=1)
                item_errors.extend(item_related_errors)
        
        if deadlock_errors or item_errors:
            all_deadlock_errors = deadlock_errors + item_errors
            # Remove duplicates
            seen = set()
            unique_errors = []
            for error in all_deadlock_errors:
                error_key = f"{error.creation}_{error.method}"
                if error_key not in seen:
                    seen.add(error_key)
                    unique_errors.append({
                        "time": error.creation,
                        "method": error.method,
                        "error_preview": error.error[:200] + "..." if len(error.error) > 200 else error.error
                    })
            
            issues.append({
                "type": "Deadlock Evidence",
                "severity": "Critical",
                "description": f"Found {len(unique_errors)} deadlock-related errors around stock entry creation time",
                "details": unique_errors,
                "fix": "Database deadlock caused incomplete transaction - fix with bundle correction and SLE regeneration",
                "time_window": f"Searched from {from_time} to {to_time}"
            })
        
        return {
            "status": "success",
            "stock_entry": stock_entry_name,
            "issues_found": len(issues),
            "issues": issues,
            "can_auto_fix": all(issue["type"] in ["Missing SLEs", "Bundle Type Mismatch"] for issue in issues)
        }
        
    except Exception as e:
        frappe.log_error(message=frappe.get_traceback(), title="Stock Entry Diagnosis Error")
        return {"status": "error", "message": str(e)}

@frappe.whitelist()
def get_stock_entry_types():
    """
    Get list of stock entry types for filter dropdown
    """
    try:
        types = frappe.db.sql("""
        SELECT DISTINCT stock_entry_type
        FROM `tabStock Entry`
        WHERE stock_entry_type IS NOT NULL
        ORDER BY stock_entry_type
        """, as_list=1)
        
        return [{"label": "All", "value": "All"}] + [{"label": t[0], "value": t[0]} for t in types]
        
    except Exception as e:
        return [{"label": "All", "value": "All"}]
