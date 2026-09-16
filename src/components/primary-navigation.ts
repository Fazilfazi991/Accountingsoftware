import type { NavigationGroup } from "@/components/app-shell";

export const primaryNavigation = [
  { label: "Home", icon: "home", href: "/" },
  { label: "Overview", icon: "overview", href: "/overview" },
  { label: "Ask FYNTA", icon: "assistant", href: "/assistant" },
  {
    label: "Sales",
    icon: "sales",
    sections: [
      {
        items: [
          ["Sales Invoice", "/sales/invoices"],
          ["Quotations", "/sales/quotations"],
          ["Delivery Notes", "/sales/delivery-notes"],
          ["Sales Return / Credit Note", "/sales/credit-notes"],
          ["Customer Receipt", "/sales/customer-payments"],
        ],
      },
    ],
  },
  {
    label: "Purchases",
    icon: "purchases",
    sections: [
      {
        items: [
          ["Purchase Bill", "/purchases/bills"],
          ["Purchase Return / Debit Note", "/purchases/debit-notes"],
          ["Supplier Payment", "/purchases/supplier-payments"],
        ],
      },
    ],
  },
  {
    label: "Inventory",
    icon: "inventory",
    sections: [
      {
        label: "Transactions",
        items: [
          ["Stock Opening", "/inventory/opening"],
          ["Stock Adjustment", "/inventory/adjustments"],
          ["Stock Transfer", "/inventory/transfers"],
        ],
      },
      {
        label: "Reports",
        items: [
          ["Stock Summary", "/reports/stock-summary"],
          ["Stock Movements", "/reports/stock-movements"],
          ["Inventory Valuation", "/reports/inventory-valuation"],
          ["Cost of Goods Sold", "/reports/cost-of-goods-sold"],
        ],
      },
      {
        label: "Masters",
        items: [
          ["Products & Services", "/products"],
          ["Stock Locations", "/inventory/locations"],
          ["Units", "/inventory/units"],
        ],
      },
    ],
  },
  {
    label: "Accounts",
    icon: "accounts",
    sections: [
      {
        label: "Transactions",
        items: [
          ["Opening Balances", "/accounting/opening-balances"],
          ["Journal Entry", "/accounting/journals"],
          ["Expenses", "/expenses"],
        ],
      },
      {
        label: "Statements",
        items: [
          ["Customer Statement", "/reports/customer-statement"],
          ["Supplier Statement", "/reports/supplier-statement"],
          ["Accounts Receivable", "/reports/accounts-receivable"],
          ["Accounts Payable", "/reports/accounts-payable"],
        ],
      },
    ],
  },
  {
    label: "Reports",
    icon: "reports",
    sections: [
      {
        label: "Financial",
        items: [
          ["Profit & Loss", "/reports/profit-loss"],
          ["Balance Sheet", "/reports/balance-sheet"],
          ["Cash Flow", "/reports/cash-flow"],
          ["Trial Balance", "/reports/trial-balance"],
          ["General Ledger", "/reports/general-ledger"],
        ],
      },
      {
        label: "Tax",
        items: [
          ["VAT Summary", "/reports/vat-summary"],
          ["VAT Transactions", "/reports/vat-transactions"],
        ],
      },
      {
        label: "Operational",
        items: [["All Operational Reports", "/reports"]],
      },
    ],
  },
  {
    label: "Masters",
    icon: "masters",
    sections: [
      {
        label: "Business",
        items: [
          ["Customers", "/sales/customers"],
          ["Suppliers", "/purchases/suppliers"],
        ],
      },
      {
        label: "Accounting",
        items: [
          ["Accounting Masters", "/accounting/masters"],
          ["Chart of Accounts", "/accounting/chart-of-accounts"],
          ["Account Groups", "/accounting/account-groups"],
          ["Cash Accounts", "/accounting/cash-accounts"],
          ["Bank Accounts", "/accounting/bank-accounts"],
          ["VAT / Tax Rates", "/accounting/tax-rates"],
          ["Financial Years", "/accounting/financial-years"],
          ["Document Numbering", "/accounting/document-numbering"],
        ],
      },
    ],
  },
  {
    label: "Settings",
    icon: "settings",
    sections: [
      {
        items: [
          ["Settings", "/settings"],
          ["Audit Log", "/settings/audit-log"],
        ],
      },
    ],
  },
] as const satisfies readonly NavigationGroup[];
