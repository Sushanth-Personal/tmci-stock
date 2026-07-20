// src/lib/expenseCategories.ts
//
// Category taxonomy for Company Expenses and Project Expenses.
// Kept as a two-level structure (Group -> Categories) so the picker UI
// can show a handful of big, obvious groups first instead of one long
// dropdown of 50+ items — that's what makes this usable for someone who
// just wants to log "paid the electricity bill" in five seconds.

export interface ExpenseGroup {
  group: string;
  icon: string;
  categories: string[];
}

export const COMPANY_EXPENSE_GROUPS: ExpenseGroup[] = [
  {
    group: "Employee Expenses",
    icon: "👥",
    categories: [
      "Salaries & Wages",
      "Bonus / Incentives",
      "Overtime Payments",
      "PF, ESI, Gratuity Contributions",
      "Staff Welfare Expenses",
      "Recruitment Expenses",
      "Training Expenses",
    ],
  },
  {
    group: "Office & Administrative",
    icon: "🏢",
    categories: [
      "Office Rent",
      "Office Maintenance",
      "Housekeeping Charges",
      "Security Charges",
      "Office Supplies & Stationery",
      "Printing & Photocopying",
      "Courier & Postage Charges",
    ],
  },
  {
    group: "Utilities",
    icon: "💡",
    categories: [
      "Electricity Bills",
      "Water Bills",
      "Internet Charges",
      "Telephone & Mobile Bills",
      "Gas Charges",
    ],
  },
  {
    group: "Travel & Conveyance",
    icon: "🚗",
    categories: [
      "Local Conveyance",
      "Fuel Expenses",
      "Vehicle Maintenance",
      "Business Travel Expenses",
      "Hotel & Accommodation Expenses",
    ],
  },
  {
    group: "Professional & Legal",
    icon: "⚖️",
    categories: [
      "Auditor Fees",
      "Consultant Fees",
      "Legal Charges",
      "Certification & Compliance (ISO, BIS, etc.)",
    ],
  },
  {
    group: "IT & Software",
    icon: "💻",
    categories: [
      "Software Licenses",
      "Cloud Services",
      "Website Hosting & Domain Renewal",
      "Computer Maintenance",
      "Antivirus & Security Software",
    ],
  },
  {
    group: "Marketing & Sales",
    icon: "📣",
    categories: [
      "Advertisement Expenses",
      "Digital Marketing Expenses",
      "Exhibition & Trade Fair Expenses",
      "Sales Promotion Expenses",
    ],
  },
  {
    group: "Financial",
    icon: "💳",
    categories: ["Bank Charges", "Interest on Loans", "Credit Card Charges"],
  },
  {
    group: "Factory & Manufacturing",
    icon: "🏭",
    categories: [
      "Factory Rent",
      "Production Staff Salaries",
      "Machine Maintenance",
      "Calibration Expenses",
      "Consumables & Tools",
      "Freight & Transportation",
      "Quality Control & Testing Expenses",
    ],
  },
  {
    group: "Other General",
    icon: "📦",
    categories: [
      "Insurance Premiums",
      "Repairs & Maintenance",
      "Membership & Subscription Fees",
      "Miscellaneous Office Expenses",
    ],
  },
];

export const PROJECT_EXPENSE_GROUPS: ExpenseGroup[] = [
  {
    group: "Manpower Costs",
    icon: "👷",
    categories: [
      "Project Engineer Salary",
      "Design Engineer Salary",
      "Technician Wages",
      "Contract Labor Charges",
      "Site Engineer Expenses",
    ],
  },
  {
    group: "Material Costs",
    icon: "🧱",
    categories: [
      "Raw Materials",
      "Bought-Out Components",
      "Electrical Components",
      "Mechanical Parts",
      "Consumables",
    ],
  },
  {
    group: "Design & Engineering",
    icon: "📐",
    categories: [
      "CAD Design Charges",
      "Drawing Preparation",
      "Project-Specific Software",
      "Prototype Development Costs",
    ],
  },
  {
    group: "Manufacturing & Assembly",
    icon: "🔧",
    categories: [
      "Fabrication Charges",
      "Machining Charges",
      "Assembly Charges",
      "Testing & Commissioning Costs",
    ],
  },
  {
    group: "Site-Related Expenses",
    icon: "🏗️",
    categories: [
      "Travel & Conveyance",
      "Accommodation & Food",
      "Site Installation Charges",
      "Site Supervision Charges",
      "Local Transportation",
    ],
  },
  {
    group: "Vendor & Subcontracting",
    icon: "🤝",
    categories: [
      "Third-Party Inspection Charges",
      "Calibration Charges",
      "Subcontractor Payments",
      "Specialized Service Charges",
    ],
  },
  {
    group: "Logistics",
    icon: "🚚",
    categories: [
      "Packing Charges",
      "Freight & Transportation",
      "Insurance for Shipment",
      "Loading & Unloading Charges",
    ],
  },
  {
    group: "Documentation & Compliance",
    icon: "📄",
    categories: [
      "Project Documentation",
      "Customer-Specific Certifications",
      "Statutory Approval Fees",
      "Inspection Fees",
    ],
  },
  {
    group: "Miscellaneous",
    icon: "🗂️",
    categories: [
      "Project Meetings",
      "Communication Expenses",
      "Contingency Expenses",
      "Project-Specific Tools & Consumables",
    ],
  },
];

export const PAYMENT_METHODS = [
  "Bank Transfer",
  "UPI",
  "Cash",
  "Card",
  "Cheque",
  "Other",
];

export function findCategoryGroup(
  groups: ExpenseGroup[],
  category: string,
): string | null {
  for (const g of groups) {
    if (g.categories.includes(category)) return g.group;
  }
  return null;
}
