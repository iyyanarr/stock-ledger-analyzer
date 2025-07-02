import frappe
from frappe import _
from frappe.utils import getdate, get_datetime, flt, cint, add_days, date_diff
import json

@frappe.whitelist()
def analyze_stock_entry_negative_history(stock_entry_name, warehouse=None, analysis_depth="50"):
    """
    Analyze a stock entry and trace negative stock history for its items
    """
    try:
        # Get the stock entry
        stock_entry = frappe.get_doc("Stock Entry", stock_entry_name)
        
        if stock_entry.docstatus != 1:
            return {"status": "error", "message": "Stock Entry is not submitted"}
        
        # Analyze each item in the stock entry
        items_analysis = []
        overview_issues = []
        all_timeline_entries = []
        
        # First, get all SLEs related to this stock entry specifically
        stock_entry_sles = frappe.db.sql("""
            SELECT 
                item_code,
                posting_date,
                posting_time,
                voucher_type,
                voucher_no,
                warehouse,
                batch_no,
                actual_qty,
                qty_after_transaction,
                creation
            FROM `tabStock Ledger Entry`
            WHERE voucher_no = %s
            ORDER BY posting_date DESC, posting_time DESC, creation DESC
        """, [stock_entry_name], as_dict=1)
        
        # Add these to timeline
        all_timeline_entries.extend(stock_entry_sles)
        
        for item in stock_entry.items:
            # For stock transfers, we need to analyze both warehouses
            warehouses_to_analyze = []
            
            if warehouse:
                # If warehouse filter is specified, only analyze that warehouse
                warehouses_to_analyze.append(warehouse)
            else:
                # Otherwise, analyze all relevant warehouses for this item
                if item.s_warehouse:
                    warehouses_to_analyze.append(item.s_warehouse)
                if item.t_warehouse and item.t_warehouse not in warehouses_to_analyze:
                    warehouses_to_analyze.append(item.t_warehouse)
                
                # If no warehouses found, this might be a manufacturing entry
                if not warehouses_to_analyze:
                    warehouses_to_analyze.append(None)  # Analyze all warehouses
            
            # Analyze each warehouse for this item
            for analyze_warehouse in warehouses_to_analyze:
                # Debug: Log what we're analyzing
                frappe.logger().info(f"Analyzing item {item.item_code} in warehouse {analyze_warehouse}")
                
                item_analysis = analyze_item_negative_history(
                    item.item_code, 
                    analyze_warehouse,
                    analysis_depth
                )
            
                if item_analysis["status"] == "success":
                    # Add warehouse info to the item data for better identification
                    item_data = item_analysis["data"].copy()
                    item_data["analyzed_warehouse"] = analyze_warehouse
                    items_analysis.append(item_data)
                    
                    # Add additional timeline entries from item analysis (avoiding duplicates)
                    for entry in item_analysis["timeline"]:
                        if not any(e["voucher_no"] == entry["voucher_no"] and 
                                 e["item_code"] == entry["item_code"] and 
                                 e["warehouse"] == entry["warehouse"] for e in all_timeline_entries):
                            all_timeline_entries.append(entry)
                    
                    # Check for issues in this item
                    if item_analysis["data"]["current_balance"] < 0:
                        overview_issues.append({
                            "type": "Negative Stock",
                            "severity": "High",
                            "description": f"Item {item.item_code} in {analyze_warehouse or 'warehouse'} has negative balance: {item_analysis['data']['current_balance']}"
                        })
        
        # Sort timeline by date, but prioritize the stock entry being analyzed
        all_timeline_entries.sort(key=lambda x: (
            0 if x["voucher_no"] == stock_entry_name else 1,  # Prioritize analyzed entry
            x["posting_date"], 
            x["posting_time"] or ""
        ), reverse=True)
        
        # Check SLE status
        existing_sle_count = frappe.db.count("Stock Ledger Entry", {"voucher_no": stock_entry_name})
        expected_sle_count = len(stock_entry.items)
        
        if existing_sle_count < expected_sle_count:
            overview_issues.append({
                "type": "Missing SLEs",
                "severity": "Critical",
                "description": f"Expected {expected_sle_count} SLEs, found {existing_sle_count}"
            })
        
        # Generate summary
        summary = {
            "items_analyzed": len(items_analysis),
            "negative_items": len([item for item in items_analysis if item["current_balance"] < 0]),
            "first_negative_date": min([item["first_negative_date"] for item in items_analysis if item["first_negative_date"]], default=None),
            "total_shortage": sum([abs(item["current_balance"]) for item in items_analysis if item["current_balance"] < 0])
        }
        
        # Generate overview with batch information
        batches_info = []
        for item in stock_entry.items:
            # Always include item information, even if no batch
            batch_info = {
                "item_code": item.item_code,
                "batch_no": item.batch_no or "No Batch",
                "qty": item.qty,
                "s_warehouse": item.s_warehouse or "",
                "t_warehouse": item.t_warehouse or ""
            }
            batches_info.append(batch_info)
        
        overview = {
            "stock_entry_name": stock_entry.name,
            "stock_entry_type": stock_entry.stock_entry_type,
            "purpose": stock_entry.purpose,
            "posting_date": str(stock_entry.posting_date),
            "company": stock_entry.company,
            "total_items": len(stock_entry.items),
            "items_with_issues": len([item for item in items_analysis if item["current_balance"] < 0]),
            "expected_sles": expected_sle_count,
            "actual_sles": existing_sle_count,
            "batches_involved": batches_info,
            "total_batches": len(batches_info),
            "issues": overview_issues
        }
        
        # Generate recommendations
        recommendations = generate_recommendations(stock_entry, items_analysis, overview_issues)
        
        return {
            "status": "success",
            "summary": summary,
            "overview": overview,
            "timeline": all_timeline_entries[-100:],  # Last 100 entries for performance
            "items": items_analysis,
            "recommendations": recommendations
        }
        
    except Exception as e:
        frappe.log_error(message=frappe.get_traceback(), title="Stock Entry Analysis Error")
        return {"status": "error", "message": str(e)}

@frappe.whitelist()
def analyze_item_negative_history(item_code, warehouse=None, analysis_depth="50"):
    """
    Analyze negative stock history for a specific item
    """
    try:
        # Build warehouse condition
        warehouse_condition = ""
        params = [item_code]
        
        if warehouse:
            warehouse_condition = "AND warehouse = %s"
            params.append(warehouse)
        
        # Determine limit
        limit_clause = ""
        if analysis_depth != "all":
            limit_clause = f"LIMIT {cint(analysis_depth)}"
        
        # Get stock ledger entries for the item
        sle_query = f"""
        SELECT 
            item_code,
            posting_date,
            posting_time,
            voucher_type,
            voucher_no,
            warehouse,
            batch_no,
            actual_qty,
            qty_after_transaction,
            creation
        FROM `tabStock Ledger Entry`
        WHERE item_code = %s {warehouse_condition}
        ORDER BY posting_date DESC, posting_time DESC, creation DESC
        {limit_clause}
        """
        
        sle_entries = frappe.db.sql(sle_query, params, as_dict=1)
        
        if not sle_entries:
            # Even if no SLEs found with limit, check if there are any SLEs at all
            if warehouse:
                total_sle_count = frappe.db.count("Stock Ledger Entry", {"item_code": item_code, "warehouse": warehouse})
            else:
                total_sle_count = frappe.db.count("Stock Ledger Entry", {"item_code": item_code})
                
            return {
                "status": "success",
                "data": {
                    "item_code": item_code,
                    "current_balance": 0,
                    "primary_warehouse": warehouse,
                    "primary_batch": None,
                    "first_negative_date": None,
                    "total_entries": total_sle_count,
                    "last_transaction_date": None,
                    "negative_periods": []
                },
                "timeline": []
            }
        
        # Analyze the entries
        current_balance = sle_entries[0]["qty_after_transaction"] if sle_entries else 0
        limited_entries_count = len(sle_entries)
        last_transaction_date = sle_entries[0]["posting_date"] if sle_entries else None
        
        # Get total entries count (not limited)
        if warehouse:
            total_entries = frappe.db.count("Stock Ledger Entry", {"item_code": item_code, "warehouse": warehouse})
        else:
            total_entries = frappe.db.count("Stock Ledger Entry", {"item_code": item_code})
        
        # Get the actual current balance from the database to ensure accuracy
        if warehouse:
            actual_current_balance_query = """
            SELECT COALESCE(SUM(actual_qty), 0) as current_balance
            FROM `tabStock Ledger Entry`
            WHERE item_code = %s AND warehouse = %s
            """
            actual_balance_result = frappe.db.sql(actual_current_balance_query, [item_code, warehouse], as_dict=1)
        else:
            actual_current_balance_query = """
            SELECT COALESCE(SUM(actual_qty), 0) as current_balance
            FROM `tabStock Ledger Entry`
            WHERE item_code = %s
            """
            actual_balance_result = frappe.db.sql(actual_current_balance_query, [item_code], as_dict=1)
            
        if actual_balance_result and actual_balance_result[0]:
            current_balance = actual_balance_result[0]["current_balance"] or 0
        
        # Find negative periods
        negative_periods = find_negative_periods(item_code, warehouse, sle_entries)
        
        # Find first negative occurrence
        first_negative_date = find_first_negative_date(item_code, warehouse)
        
        # Determine primary warehouse and batch
        primary_warehouse = get_primary_warehouse(sle_entries)
        primary_batch = get_primary_batch(sle_entries)
        
        item_data = {
            "item_code": item_code,
            "current_balance": current_balance,
            "primary_warehouse": primary_warehouse,
            "primary_batch": primary_batch,
            "first_negative_date": first_negative_date,
            "total_entries": total_entries,
            "last_transaction_date": last_transaction_date,
            "negative_periods": negative_periods
        }
        
        return {
            "status": "success",
            "data": item_data,
            "timeline": list(reversed(sle_entries))  # Reverse to show chronological order
        }
        
    except Exception as e:
        frappe.log_error(message=frappe.get_traceback(), title="Item Analysis Error")
        return {"status": "error", "message": str(e)}

@frappe.whitelist()
def find_all_negative_stock_items(warehouse=None, stock_entry_type=None, item_code=None):
    """
    Find all items currently having negative stock, optionally filtered by warehouse, stock entry type, and item code
    """
    try:
        warehouse_condition = ""
        stock_entry_type_condition = ""
        item_code_condition = ""
        params = []
        
        if warehouse:
            warehouse_condition = "AND sle.warehouse = %s"
            params.append(warehouse)
            
        if item_code:
            item_code_condition = "AND sle.item_code = %s"
            params.append(item_code)
            
        if stock_entry_type:
            stock_entry_type_condition = "AND se.stock_entry_type = %s"
            params.append(stock_entry_type)
        
        # Enhanced query that can filter by stock entry type
        if stock_entry_type:
            # When filtering by stock entry type, we need to join with Stock Entry
            query = f"""
            SELECT 
                sle.item_code,
                sle.warehouse,
                SUM(sle.actual_qty) as current_balance,
                COUNT(sle.name) as total_entries,
                MIN(CASE WHEN sle.qty_after_transaction < 0 THEN sle.posting_date END) as first_negative_date,
                GROUP_CONCAT(DISTINCT se.stock_entry_type) as related_entry_types,
                COUNT(DISTINCT CASE WHEN se.stock_entry_type = %s THEN sle.name END) as filtered_type_entries
            FROM `tabStock Ledger Entry` sle
            LEFT JOIN `tabStock Entry` se ON sle.voucher_no = se.name AND sle.voucher_type = 'Stock Entry'
            WHERE 1=1 {warehouse_condition} {item_code_condition} {stock_entry_type_condition}
            GROUP BY sle.item_code, sle.warehouse
            HAVING current_balance < 0
            ORDER BY current_balance ASC
            """
            params.append(stock_entry_type)  # For the COUNT DISTINCT clause
        else:
            # Original query when no stock entry type filter
            query = f"""
            SELECT 
                sle.item_code,
                sle.warehouse,
                SUM(sle.actual_qty) as current_balance,
                COUNT(sle.name) as total_entries,
                MIN(CASE WHEN sle.qty_after_transaction < 0 THEN sle.posting_date END) as first_negative_date,
                GROUP_CONCAT(DISTINCT CASE WHEN sle.voucher_type = 'Stock Entry' THEN 
                    (SELECT stock_entry_type FROM `tabStock Entry` WHERE name = sle.voucher_no LIMIT 1)
                END) as related_entry_types
            FROM `tabStock Ledger Entry` sle
            WHERE 1=1 {warehouse_condition} {item_code_condition}
            GROUP BY sle.item_code, sle.warehouse
            HAVING current_balance < 0
            ORDER BY current_balance ASC
            """
        
        negative_items = frappe.db.sql(query, params, as_dict=1)
        
        # Add batch breakdown for each negative item
        for item in negative_items:
            item['batch_breakdown'] = get_batch_breakdown(item['item_code'], item['warehouse'])
        
        return {
            "status": "success",
            "data": negative_items,
            "filter_applied": {
                "warehouse": warehouse,
                "stock_entry_type": stock_entry_type,
                "item_code": item_code
            }
        }
        
    except Exception as e:
        frappe.log_error(message=frappe.get_traceback(), title="Negative Items Search Error")
        return {"status": "error", "message": str(e)}

def find_negative_periods(item_code, warehouse, sle_entries):
    """
    Find periods when the item was in negative stock
    """
    negative_periods = []
    current_period = None
    
    # Sort entries chronologically
    sorted_entries = sorted(sle_entries, key=lambda x: (x["posting_date"], x["posting_time"] or ""))
    
    for entry in sorted_entries:
        balance = entry["qty_after_transaction"]
        
        if balance < 0:
            if current_period is None:
                # Start of a negative period
                current_period = {
                    "start_date": entry["posting_date"],
                    "trigger_document": f"{entry['voucher_type']} {entry['voucher_no']}",
                    "min_balance": balance,
                    "end_date": None,
                    "duration_days": 0
                }
            else:
                # Update minimum balance in current period
                if balance < current_period["min_balance"]:
                    current_period["min_balance"] = balance
        else:
            if current_period is not None:
                # End of negative period
                current_period["end_date"] = entry["posting_date"]
                current_period["duration_days"] = date_diff(current_period["end_date"], current_period["start_date"])
                negative_periods.append(current_period)
                current_period = None
    
    # If still in negative period
    if current_period is not None:
        current_period["end_date"] = None  # Ongoing
        current_period["duration_days"] = date_diff(frappe.utils.nowdate(), current_period["start_date"])
        negative_periods.append(current_period)
    
    return negative_periods

def find_first_negative_date(item_code, warehouse):
    """
    Find the very first date when this item went negative
    """
    try:
        warehouse_condition = ""
        params = [item_code]
        
        if warehouse:
            warehouse_condition = "AND warehouse = %s"
            params.append(warehouse)
        
        query = f"""
        SELECT posting_date
        FROM `tabStock Ledger Entry`
        WHERE item_code = %s {warehouse_condition}
        AND qty_after_transaction < 0
        ORDER BY posting_date ASC, posting_time ASC, creation ASC
        LIMIT 1
        """
        
        result = frappe.db.sql(query, params, as_dict=1)
        return result[0]["posting_date"] if result else None
        
    except Exception:
        return None

def get_primary_warehouse(sle_entries):
    """
    Get the most frequently used warehouse
    """
    warehouse_counts = {}
    for entry in sle_entries:
        warehouse = entry["warehouse"]
        warehouse_counts[warehouse] = warehouse_counts.get(warehouse, 0) + 1
    
    if warehouse_counts:
        return max(warehouse_counts, key=warehouse_counts.get)
    return None

def get_primary_batch(sle_entries):
    """
    Get the most frequently used batch
    """
    batch_counts = {}
    for entry in sle_entries:
        batch = entry["batch_no"]
        if batch:
            batch_counts[batch] = batch_counts.get(batch, 0) + 1
    
    if batch_counts:
        return max(batch_counts, key=batch_counts.get)
    return None

def generate_recommendations(stock_entry, items_analysis, issues):
    """
    Generate actionable recommendations based on the analysis
    """
    recommendations = []
    
    # Check for missing SLEs
    missing_sle_issue = next((issue for issue in issues if issue["type"] == "Missing SLEs"), None)
    if missing_sle_issue:
        recommendations.append({
            "title": "Fix Missing Stock Ledger Entries",
            "priority": "High",
            "description": "Some stock ledger entries are missing for this stock entry.",
            "action": "Use the Stock Entry Issues Detector to fix missing SLEs while preserving original posting dates",
            "estimated_impact": "Will restore accurate stock balances and fix reporting discrepancies"
        })
    
    # Check for negative stock items
    negative_items = [item for item in items_analysis if item["current_balance"] < 0]
    if negative_items:
        total_shortage = sum([abs(item["current_balance"]) for item in negative_items])
        recommendations.append({
            "title": "Address Negative Stock Issues",
            "priority": "High",
            "description": f"Found {len(negative_items)} items with negative stock totaling {total_shortage:.2f} units.",
            "action": "Conduct physical inventory count and create Stock Reconciliation documents to correct balances",
            "estimated_impact": "Will resolve negative stock and improve inventory accuracy"
        })
    
    # Check for long-term negative stock
    chronic_negative = [item for item in negative_items if item["negative_periods"] and 
                      any(period["duration_days"] > 30 for period in item["negative_periods"])]
    if chronic_negative:
        recommendations.append({
            "title": "Review Inventory Management Processes",
            "priority": "Medium",
            "description": f"Found {len(chronic_negative)} items that have been in negative stock for extended periods.",
            "action": "Review purchasing, manufacturing, and inventory control processes. Consider implementing automated reorder points",
            "estimated_impact": "Will prevent future negative stock occurrences"
        })
    
    # Check for batch inconsistencies
    batch_items = [item for item in items_analysis if item["primary_batch"]]
    if batch_items:
        recommendations.append({
            "title": "Standardize Batch Numbering",
            "priority": "Medium",
            "description": "Multiple batch number formats detected which may cause validation issues.",
            "action": "Implement consistent batch numbering conventions and validate existing batch numbers",
            "estimated_impact": "Will reduce batch-related errors and improve traceability"
        })
    
    # General recommendation for monitoring
    recommendations.append({
        "title": "Implement Regular Stock Monitoring",
        "priority": "Low",
        "description": "Regular monitoring can help detect and prevent stock issues early.",
        "action": "Set up automated alerts for negative stock occurrences and schedule weekly stock health checks",
        "estimated_impact": "Will provide early warning system for inventory issues"
    })
    
    return recommendations

@frappe.whitelist()
def fix_negative_stock_item(item_code, warehouse, current_balance, fix_method="stock_reconciliation", posting_date=None):
    """
    Fix negative stock for a single item using various methods
    """
    try:
        if not posting_date:
            posting_date = frappe.utils.nowdate()
            
        # Validate inputs
        if not item_code or not warehouse:
            return {"status": "error", "message": "Item Code and Warehouse are required"}
            
        current_balance = flt(current_balance)
        if current_balance >= 0:
            return {"status": "error", "message": "Item is not in negative stock"}
            
        # Get item details
        item_doc = frappe.get_doc("Item", item_code)
        if not item_doc:
            return {"status": "error", "message": f"Item {item_code} not found"}
            
        # Calculate correction quantity (make it zero or positive)
        correction_qty = abs(current_balance)  # This will make the balance zero
        
        if fix_method == "stock_reconciliation":
            result = create_stock_reconciliation(item_code, warehouse, correction_qty, posting_date)
        else:
            return {"status": "error", "message": f"Fix method {fix_method} not implemented"}
            
        return result
        
    except Exception as e:
        frappe.log_error(message=frappe.get_traceback(), title="Fix Negative Stock Error")
        return {"status": "error", "message": str(e)}

def create_stock_reconciliation(item_code, warehouse, target_qty, posting_date):
    """
    Create a Stock Reconciliation entry to fix negative stock
    """
    try:
        # Get item details to check if it's batch-tracked
        item_doc = frappe.get_doc("Item", item_code)
        has_batch_no = item_doc.has_batch_no
        
        # Create Stock Reconciliation document
        stock_recon = frappe.new_doc("Stock Reconciliation")
        stock_recon.purpose = "Stock Reconciliation"
        stock_recon.posting_date = posting_date
        stock_recon.posting_time = frappe.utils.nowtime()
        stock_recon.set_posting_time = 1
        
        # Get current batches if item is batch-tracked
        batch_wise_qty = {}
        if has_batch_no and target_qty > 0:
            # Get existing batches for this item in this warehouse
            existing_batches = frappe.db.sql("""
                SELECT batch_no, SUM(actual_qty) as current_qty
                FROM `tabStock Ledger Entry`
                WHERE item_code = %s AND warehouse = %s AND batch_no IS NOT NULL
                GROUP BY batch_no
                HAVING current_qty < 0
                ORDER BY batch_no
            """, [item_code, warehouse], as_dict=1)
            
            if existing_batches:
                # Distribute target quantity among negative batches
                total_negative = sum([abs(batch.current_qty) for batch in existing_batches])
                remaining_qty = target_qty
                
                for i, batch in enumerate(existing_batches):
                    if i == len(existing_batches) - 1:  # Last batch gets remaining qty
                        batch_qty = remaining_qty
                    else:
                        # Proportional distribution
                        proportion = abs(batch.current_qty) / total_negative
                        batch_qty = flt(target_qty * proportion, 3)
                        remaining_qty -= batch_qty
                    
                    if batch_qty > 0:
                        batch_wise_qty[batch.batch_no] = batch_qty
            else:
                # If no existing batches, create with a new batch
                new_batch_no = f"RECON-{frappe.utils.nowdate()}-{frappe.utils.random_string(4)}"
                batch_wise_qty[new_batch_no] = target_qty
        
        # Add item to reconciliation
        item_row = stock_recon.append("items", {
            "item_code": item_code,
            "warehouse": warehouse,
            "qty": target_qty,
            "valuation_rate": get_item_valuation_rate(item_code, warehouse)
        })
        
        # Create Serial and Batch Bundle if needed
        if has_batch_no and batch_wise_qty:
            # Create Serial and Batch Bundle
            bundle_doc = frappe.new_doc("Serial and Batch Bundle")
            bundle_doc.item_code = item_code
            bundle_doc.warehouse = warehouse
            bundle_doc.type_of_transaction = "Inward"
            bundle_doc.voucher_type = "Stock Reconciliation"
            
            # Add batch entries
            for batch_no, qty in batch_wise_qty.items():
                # Create batch if it doesn't exist
                if not frappe.db.exists("Batch", batch_no):
                    batch_doc = frappe.new_doc("Batch")
                    batch_doc.batch_id = batch_no
                    batch_doc.item = item_code
                    batch_doc.insert()
                
                bundle_doc.append("entries", {
                    "batch_no": batch_no,
                    "qty": qty
                })
            
            # Insert the bundle
            bundle_doc.insert()
            
            # Link bundle to stock reconciliation item
            item_row.serial_and_batch_bundle = bundle_doc.name
        
        # Insert and submit the document
        stock_recon.insert()
        stock_recon.submit()
        
        return {
            "status": "success",
            "message": f"Stock Reconciliation {stock_recon.name} created successfully",
            "document": stock_recon.name,
            "corrected_qty": target_qty,
            "batch_details": batch_wise_qty if has_batch_no else None
        }
        
    except Exception as e:
        frappe.log_error(message=frappe.get_traceback(), title="Stock Reconciliation Creation Error")
        return {"status": "error", "message": f"Failed to create Stock Reconciliation: {str(e)}"}

def get_item_valuation_rate(item_code, warehouse):
    """
    Get the valuation rate for an item in a warehouse
    """
    try:
        # Get the latest valuation rate from Stock Ledger Entry
        valuation_rate = frappe.db.sql("""
            SELECT valuation_rate 
            FROM `tabStock Ledger Entry` 
            WHERE item_code = %s AND warehouse = %s 
            AND valuation_rate > 0
            ORDER BY posting_date DESC, posting_time DESC, creation DESC 
            LIMIT 1
        """, (item_code, warehouse))
        
        if valuation_rate:
            return flt(valuation_rate[0][0])
            
        # Fallback to item's standard rate
        standard_rate = frappe.db.get_value("Item", item_code, "standard_rate")
        if standard_rate:
            return flt(standard_rate)
            
        # Final fallback to 0
        return 0.0
        
    except Exception:
        return 0.0

@frappe.whitelist()
def bulk_fix_negative_stock_items(items_data, fix_method="stock_reconciliation", posting_date=None):
    """
    Fix multiple negative stock items in bulk
    items_data: JSON string containing list of items with item_code, warehouse, current_balance
    """
    try:
        if isinstance(items_data, str):
            items_data = frappe.parse_json(items_data)
            
        if not posting_date:
            posting_date = frappe.utils.nowdate()
            
        results = []
        success_count = 0
        error_count = 0
        
        for item_data in items_data:
            result = fix_negative_stock_item(
                item_data.get("item_code"),
                item_data.get("warehouse"), 
                item_data.get("current_balance"),
                fix_method,
                posting_date
            )
            
            results.append({
                "item_code": item_data.get("item_code"),
                "warehouse": item_data.get("warehouse"),
                "result": result
            })
            
            if result.get("status") == "success":
                success_count += 1
            else:
                error_count += 1
                
        return {
            "status": "success" if error_count == 0 else "partial",
            "message": f"Processed {len(items_data)} items: {success_count} successful, {error_count} failed",
            "success_count": success_count,
            "error_count": error_count,
            "results": results
        }
        
    except Exception as e:
        frappe.log_error(message=frappe.get_traceback(), title="Bulk Fix Negative Stock Error")
        return {"status": "error", "message": str(e)}

def get_batch_breakdown(item_code, warehouse):
    """
    Get batch-wise breakdown of negative stock for an item in a warehouse
    """
    try:
        # Check if item is batch-tracked
        item_doc = frappe.get_doc("Item", item_code)
        if not item_doc.has_batch_no:
            return None
            
        # Get batch-wise stock for this item in this warehouse
        batch_query = """
        SELECT 
            batch_no,
            SUM(actual_qty) as batch_balance,
            COUNT(name) as entries_count,
            MIN(posting_date) as first_transaction,
            MAX(posting_date) as last_transaction
        FROM `tabStock Ledger Entry`
        WHERE item_code = %s AND warehouse = %s AND batch_no IS NOT NULL
        GROUP BY batch_no
        HAVING batch_balance < 0
        ORDER BY batch_balance ASC
        """
        
        batch_results = frappe.db.sql(batch_query, [item_code, warehouse], as_dict=1)
        
        return batch_results if batch_results else []
        
    except Exception as e:
        frappe.log_error(message=frappe.get_traceback(), title="Batch Breakdown Error")
        return []

@frappe.whitelist()
def fix_negative_stock_batch(item_code, warehouse, batch_no, current_balance, fix_method="stock_reconciliation", posting_date=None):
    """
    Fix negative stock for a specific batch of an item
    """
    try:
        if not posting_date:
            posting_date = frappe.utils.nowdate()
            
        # Validate inputs
        if not item_code or not warehouse or not batch_no:
            return {"status": "error", "message": "Item Code, Warehouse, and Batch No are required"}
            
        current_balance = flt(current_balance)
        if current_balance >= 0:
            return {"status": "error", "message": "Batch is not in negative stock"}
            
        # Get item details
        item_doc = frappe.get_doc("Item", item_code)
        if not item_doc:
            return {"status": "error", "message": f"Item {item_code} not found"}
            
        if not item_doc.has_batch_no:
            return {"status": "error", "message": f"Item {item_code} is not batch-tracked"}
            
        # Verify batch exists
        if not frappe.db.exists("Batch", batch_no):
            return {"status": "error", "message": f"Batch {batch_no} not found"}
            
        # Calculate correction quantity (make it zero)
        correction_qty = abs(current_balance)  # This will make the balance zero
        
        if fix_method == "stock_reconciliation":
            result = create_batch_stock_reconciliation(item_code, warehouse, batch_no, correction_qty, posting_date)
        else:
            return {"status": "error", "message": f"Fix method {fix_method} not implemented"}
            
        return result
        
    except Exception as e:
        frappe.log_error(message=frappe.get_traceback(), title="Fix Negative Stock Batch Error")
        return {"status": "error", "message": str(e)}

def create_batch_stock_reconciliation(item_code, warehouse, batch_no, target_qty, posting_date):
    """
    Create a Stock Reconciliation entry to fix negative stock for a specific batch
    """
    try:
        # Create Stock Reconciliation document
        stock_recon = frappe.new_doc("Stock Reconciliation")
        stock_recon.purpose = "Stock Reconciliation"
        stock_recon.posting_date = posting_date
        stock_recon.posting_time = frappe.utils.nowtime()
        stock_recon.set_posting_time = 1
        
        # Add item to reconciliation
        item_row = stock_recon.append("items", {
            "item_code": item_code,
            "warehouse": warehouse,
            "qty": target_qty,
            "valuation_rate": get_item_valuation_rate(item_code, warehouse)
        })
        
        # Create Serial and Batch Bundle for the specific batch
        bundle_doc = frappe.new_doc("Serial and Batch Bundle")
        bundle_doc.item_code = item_code
        bundle_doc.warehouse = warehouse
        bundle_doc.type_of_transaction = "Inward"
        bundle_doc.voucher_type = "Stock Reconciliation"
        
        # Add the specific batch entry
        bundle_doc.append("entries", {
            "batch_no": batch_no,
            "qty": target_qty
        })
        
        # Insert the bundle
        bundle_doc.insert()
        
        # Link bundle to stock reconciliation item
        item_row.serial_and_batch_bundle = bundle_doc.name
        
        # Insert and submit the document
        stock_recon.insert()
        stock_recon.submit()
        
        return {
            "status": "success",
            "message": f"Stock Reconciliation {stock_recon.name} created successfully for batch {batch_no}",
            "document": stock_recon.name,
            "corrected_qty": target_qty,
            "batch_no": batch_no
        }
        
    except Exception as e:
        frappe.log_error(message=frappe.get_traceback(), title="Batch Stock Reconciliation Creation Error")
        return {"status": "error", "message": f"Failed to create Stock Reconciliation for batch: {str(e)}"}
