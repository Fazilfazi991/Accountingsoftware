"use server";

import { requireOrganizationContext } from "@/lib/organization-context";
import { createClient } from "@/lib/supabase/server";
import { dubaiCalendarDate } from "@/lib/dubai-date";

export type DashboardActivity = {
  date: string;
  type: string;
  document_id: string;
  document_number: string;
  party_reference: string;
  amount: number;
  journal_id: string;
  href: string;
};

export type DashboardData = {
  organization_id: string;
  branch_id: string;
  cash_on_hand: number;
  cash_account_id: string;
  cash_at_bank: number;
  bank_account_count: number;
  bank_accounts: {
    bank_account_id: string;
    account_id: string;
    name: string;
    balance: number;
  }[];
  receivables: number;
  receivable_count: number;
  payables: number;
  payable_count: number;
  recent_activity: DashboardActivity[];
  month_revenue: number | null;
  revenue_from: string;
  revenue_to: string;
};

type ProfitLossSummary = { revenue?: number };

export async function getLiveDashboard(): Promise<DashboardData | { error: string }> {
  try {
    const context = await requireOrganizationContext();
    const client = await createClient();
    const revenueTo = dubaiCalendarDate();
    const revenueFrom = `${revenueTo.slice(0, 7)}-01`;
    const scope = {
      p_organization_id: context.organization.id,
      p_branch_id: context.branch.id,
    };
    const [dashboardResult, revenueResult] = await Promise.all([
      client.rpc("get_live_dashboard", scope),
      client.rpc("get_profit_and_loss", {
        ...scope,
        p_from: revenueFrom,
        p_to: revenueTo,
      }),
    ]);

    if (dashboardResult.error || !dashboardResult.data) {
      return { error: "Unable to load live accounting balances." };
    }

    const profitLoss = revenueResult.data as ProfitLossSummary | null;
    return {
      ...(dashboardResult.data as Omit<DashboardData, "month_revenue" | "revenue_from" | "revenue_to">),
      month_revenue: revenueResult.error || profitLoss?.revenue === undefined
        ? null
        : Number(profitLoss.revenue),
      revenue_from: revenueFrom,
      revenue_to: revenueTo,
    };
  } catch {
    return { error: "Unable to load live accounting balances." };
  }
}
