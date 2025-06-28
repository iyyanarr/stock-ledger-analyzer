# Stock Ledger Analyzer

A Frappe app for analyzing Stock Ledger Entry (SLE) issues in ERPNext. This tool helps identify missing and incomplete SLE records with business-aligned logic.

## Features

### Two Critical Scenarios Detection

**Scenario 1: No SLE Created**
- Detects stock entries that should have created SLE records but have 0 SLE records
- Example: Material Transfer entries with warehouse movements but no corresponding ledger entries

**Scenario 2: Partial SLE** 
- Detects stock entries with incomplete SLE records
- Example: Entry expects 10 SLE records but only has 4 created

## Key Capabilities

- **Accurate SLE Calculation**: Uses proper movement count logic based on actual warehouse transfers
- **Advanced Filtering**: Filter by date range, company, and warehouse
- **Performance Optimized**: Targeted queries with limits for large datasets
- **Detailed Analysis**: Shows expected vs actual SLE counts with movement descriptions
- **Business-Aligned Logic**: Verified against real ERPNext data patterns

## Installation

1. Get the app from this repository
```bash
bench get-app https://github.com/iyyanarr/stock-ledger-analyzer.git
```

2. Install the app on your site
```bash
bench --site your-site install-app stock_ledger_fixer
```

3. Build the assets
```bash
bench build --app stock_ledger_fixer
```

## Usage

1. Navigate to **Stock Ledger Analyzer** page in ERPNext
2. Set your filters (date range, company, warehouse)
3. Click **Analyze** to detect problematic entries
4. Review the results showing:
   - Count of entries with no SLE created
   - Count of entries with partial SLE  
   - Detailed table of problematic entries with issue descriptions

## Technical Details

### Components
- `stock_ledger_analyzer.json`: Page configuration
- `stock_ledger_analyzer.js`: Frontend with Frappe-style controls and UI
- `stock_ledger_analyzer.py`: Backend with analysis logic and summary methods

### Verification
The logic has been manually verified against real database entries:
- **Scenario 1 Example**: RLI-2024-00419 (Material Transfer with 1 expected movement, 0 SLE)
- **Scenario 2 Example**: STE-2025-06875 (29 expected movements, 21 actual SLE)

## Requirements

- Frappe Framework
- ERPNext with Stock module
- Stock Entry and Stock Ledger Entry doctypes

## License

MIT License

---

**Note**: This tool is designed for analysis and detection only. Always backup your data before making any corrective actions based on the analysis results.