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
        
        for item in stock_entry.items:
            item_analysis = analyze_item_negative_history(
                item.item_code, 
                warehouse or item.s_warehouse or item.t_warehouse,
                analysis_depth
            )
            
            if item_analysis["status"] == "success":
                items_analysis.append(item_analysis["data"])
                all_timeline_entries.extend(item_analysis["timeline"])
                
                # Check for issues in this item
                if item_analysis["data"]["current_balance"] < 0:
                    overview_issues.append({
                        "type": "Negative Stock",
                        "severity": "High",
                        "description": f"Item {item.item_code} has negative balance: {item_analysis['data']['current_balance']}"
                    })
        
        # Sort timeline by date
        all_timeline_entries.sort(key=lambda x: (x["posting_date"], x["posting_time"] or ""))
        
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
        
        # Generate overview
        overview = {
            "stock_entry_name": stock_entry.name,
            "stock_entry_type": stock_entry.stock_entry_type,
            "purpose": stock_entry.purpose,
            "posting_date": stock_entry.posting_date,
            "company": stock_entry.company,
            "total_items": len(stock_entry.items),
            "items_with_issues": len([item for item in items_analysis if item["current_balance"] < 0]),
            "expected_sles": expected_sle_count,
            "actual_sles": existing_sle_count,
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
            return {
                "status": "success",
                "data": {
                    "item_code": item_code,
                    "current_balance": 0,
                    "primary_warehouse": warehouse,
                    "primary_batch": None,
                    "first_negative_date": None,
                    "total_entries": 0,
                    "last_transaction_date": None,
                    "negative_periods": []
                },
                "timeline": []
            }
        
        # Analyze the entries
        current_balance = sle_entries[0]["qty_after_transaction"]
        total_entries = len(sle_entries)
        last_transaction_date = sle_entries[0]["posting_date"]
        
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
def find_all_negative_stock_items(warehouse=None, stock_entry_type=None):
    """
    Find all items currently having negative stock, optionally filtered by stock entry type
    """
    try:
        warehouse_condition = ""
        stock_entry_type_condition = ""
        params = []
        
        if warehouse:
            warehouse_condition = "AND sle.warehouse = %s"
            params.append(warehouse)
            
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
            WHERE 1=1 {warehouse_condition} {stock_entry_type_condition}
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
            WHERE 1=1 {warehouse_condition}
            GROUP BY sle.item_code, sle.warehouse
            HAVING current_balance < 0
            ORDER BY current_balance ASC
            """
        
        negative_items = frappe.db.sql(query, params, as_dict=1)
        
        return {
            "status": "success",
            "data": negative_items,
            "filter_applied": {
                "warehouse": warehouse,
                "stock_entry_type": stock_entry_type
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
