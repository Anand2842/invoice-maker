# TDS

The TDS workspace records tax withheld on vendor bills and on customer receipts. Choose the business and real or demo data mode before viewing the register or posting commands. The two modes have separate sections, deductions, challans, receipts and journals. Ledger setup is required; customer receipts also require automatic invoice and receipt posting.

For a saved vendor bill, select a section and enter the vendor PAN. Rates are effective-dated and may be edited for the business. A missing PAN applies section 206AA: the higher of the section rate and 20%, or 5% for 194Q. TDS is calculated on the taxable amount before separately shown GST, rounded to paise. Threshold notices request review and do not suppress a selected deduction. Verify the section, rate and threshold against the facts before posting. Issuing posts the gross expense and input GST, net accounts payable and a separate section liability. Vendor payments settle net payable. Reverse any payments first before reversing a bill; reversals are dated entries.

Record a challan with its seven-digit BSR code, five-digit serial, deposit date, section, bank/cash account, principal and any interest or late fee. Allocate principal to the relevant deductions; allocations cannot exceed either the deduction or challan. The register displays due dates and deposit status. Export the register as CSV or JSON for preparing Form 26Q; this is a preparation export, not a filing or Form 16A certificate.

For customer withholding, record the net cash and TDS amounts together against the invoice. The gross sum settles receivables, while TDS is posted to a separate receivable account. Enter the customer PAN, TAN and certificate reference when available. The receivable register supports claimed/unclaimed reconciliation and CSV export for comparison with 26AS/AIS. Reversing the receipt restores the invoice balance and reverses the TDS entry on the correction date.

All entries record accounting events only. No funds are transferred and no external government filing, certificate retrieval or verification is performed.
