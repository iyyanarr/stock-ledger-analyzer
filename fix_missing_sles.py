#!/usr/bin/env python3
"""
Automated SLE Fixer Script
Creates missing Stock Ledger Entries for problematic Stock Entries
"""

import frappe
from frappe.utils import flt, cstr
from erpnext.stock.stock_ledger import make_sl_entries

def fix_missing_sles_bulk():
    """Find and fix all missing SLEs automatically"""
    
    # Find all stock entries with missing SLEs
    problematic_entries = frappe.db.sql("""
        SELECT DISTINCT se.name, se.posting_date, se.posting_time, se.company
        FROM `tabStock Entry` se
        INNER JOIN `tabStock Entry Detail` sed ON sed.parent = se.name
        LEFT JOIN `tabStock Ledger Entry` sle ON sle.voucher_no = se.name 
            AND sle.voucher_detail_no = sed.name
        WHERE se.docstatus = 1
        AND se.posting_date >= '2025-06-01'  -- Current month
        AND sed.s_warehouse IS NOT NULL  -- Source warehouse items
        AND sle.name IS NULL  -- Missing SLE
        ORDER BY se.posting_date, se.posting_time
    """, as_dict=True)
    
    print(f"Found {len(problematic_entries)} stock entries with missing SLEs")
    
    fixed_count = 0
    error_count = 0
    
    for entry in problematic_entries:
        try:
            fix_single_stock_entry(entry.name)
            fixed_count += 1
            print(f"✅ Fixed: {entry.name}")
            
            # Commit every 10 entries to avoid memory issues
            if fixed_count % 10 == 0:
                frappe.db.commit()
                
        except Exception as e:
            error_count += 1
            print(f"❌ Error fixing {entry.name}: {str(e)}")
            continue
    
    frappe.db.commit()
    print(f"🎉 Summary: {fixed_count} fixed, {error_count} errors")

def fix_single_stock_entry(stock_entry_name):
    """Fix missing SLEs for a single stock entry"""
    
    # Get stock entry details
    stock_entry = frappe.get_doc("Stock Entry", stock_entry_name)
    
    # Find missing SLE items
    missing_items = frappe.db.sql("""
        SELECT sed.name as detail_name, sed.item_code, sed.s_warehouse, 
               sed.qty, sed.transfer_qty, sed.serial_and_batch_bundle,
               sed.basic_rate, sed.amount
        FROM `tabStock Entry Detail` sed
        LEFT JOIN `tabStock Ledger Entry` sle ON sle.voucher_detail_no = sed.name
        WHERE sed.parent = %s
        AND sed.s_warehouse IS NOT NULL
        AND sle.name IS NULL
    """, (stock_entry_name,), as_dict=True)
    
    if not missing_items:
        return
    
    # Create SLEs for missing items
    sl_entries = []
    
    for item in missing_items:
        sle = {
            'item_code': item.item_code,
            'warehouse': item.s_warehouse,
            'posting_date': stock_entry.posting_date,
            'posting_time': stock_entry.posting_time,
            'voucher_type': 'Stock Entry',
            'voucher_no': stock_entry_name,
            'voucher_detail_no': item.detail_name,
            'actual_qty': -flt(item.transfer_qty),  # NEGATIVE for outward
            'incoming_rate': 0,
            'outgoing_rate': flt(item.basic_rate) if item.basic_rate else 0,
            'company': stock_entry.company,
            'fiscal_year': frappe.db.get_value("Company", stock_entry.company, "default_fiscal_year"),
            'is_cancelled': 0,
            'batch_no': get_batch_from_bundle(item.serial_and_batch_bundle),
            'serial_and_batch_bundle': item.serial_and_batch_bundle,
            'stock_uom': frappe.db.get_value("Item", item.item_code, "stock_uom"),
            'doctype': 'Stock Ledger Entry'
        }
        sl_entries.append(sle)
    
    # Create the SLEs
    if sl_entries:
        make_sl_entries(sl_entries, allow_negative_stock=True)

def get_batch_from_bundle(bundle_name):
    """Get batch number from serial and batch bundle"""
    if not bundle_name:
        return None
    
    batch = frappe.db.sql("""
        SELECT batch_no FROM `tabSerial and Batch Bundle Entry`
        WHERE parent = %s AND batch_no IS NOT NULL
        LIMIT 1
    """, (bundle_name,))
    
    return batch[0][0] if batch else None

if __name__ == "__main__":
    # Run the script
    fix_missing_sles_bulk()
