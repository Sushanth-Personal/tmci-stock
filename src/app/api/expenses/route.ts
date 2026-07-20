// src/app/api/expenses/route.ts
//
// GET    /api/expenses?type=company|project&from=&to=&group=&category=&project=&q=
// POST   /api/expenses            → create one
// POST   /api/expenses  (array)   → create many (bulk import from paste/scan)
// PATCH  /api/expenses            → update one, body must include { id, ...fields }
// DELETE /api/expenses?id=uuid    → soft delete (moves to bin)

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key);
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type"); // "company" | "project"
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const group = searchParams.get("group");
    const category = searchParams.get("category");
    const project = searchParams.get("project");
    const q = (searchParams.get("q") ?? "").trim();
    const bin = searchParams.get("bin") === "1";

    const supabase = getSupabase();
    let query = supabase
      .from("expenses")
      .select("*")
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(2000);

    query = bin
      ? query.not("deleted_at", "is", null)
      : query.is("deleted_at", null);

    if (type) query = query.eq("expense_type", type);
    if (from) query = query.gte("date", from);
    if (to) query = query.lte("date", to);
    if (group) query = query.eq("category_group", group);
    if (category) query = query.eq("category", category);
    if (project) query = query.ilike("project_name", `%${project}%`);
    if (q) {
      query = query.or(
        `description.ilike.%${q}%,vendor.ilike.%${q}%,category.ilike.%${q}%,project_name.ilike.%${q}%`,
      );
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ expenses: data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

function normalizeRow(body: any) {
  if (
    !body.expense_type ||
    !["company", "project"].includes(body.expense_type)
  ) {
    throw new Error("expense_type must be 'company' or 'project'");
  }
  if (!body.date) throw new Error("date is required");
  if (!body.category_group) throw new Error("category_group is required");
  if (!body.category) throw new Error("category is required");
  if (body.amount === undefined || body.amount === null || +body.amount <= 0) {
    throw new Error("amount must be greater than 0");
  }

  return {
    expense_type: body.expense_type,
    date: body.date,
    category_group: body.category_group,
    category: body.category,
    description: body.description || null,
    vendor: body.vendor || null,
    payment_method: body.payment_method || null,
    reference_no: body.reference_no || null,
    amount: +body.amount,
    project_name:
      body.expense_type === "project" ? body.project_name || null : null,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const supabase = getSupabase();

    if (Array.isArray(body)) {
      if (body.length === 0) {
        return NextResponse.json({ error: "Empty batch" }, { status: 400 });
      }
      const rows = body.map(normalizeRow);
      const { data, error } = await supabase
        .from("expenses")
        .insert(rows)
        .select();
      if (error) throw error;
      return NextResponse.json({ expenses: data, count: data?.length ?? 0 });
    }

    const row = normalizeRow(body);
    const { data, error } = await supabase
      .from("expenses")
      .insert(row)
      .select()
      .single();
    if (error) throw error;

    return NextResponse.json({ expense: data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, ...rest } = body;
    if (!id)
      return NextResponse.json({ error: "id is required" }, { status: 400 });

    const patch: Record<string, any> = {};
    const editable = [
      "date",
      "category_group",
      "category",
      "description",
      "vendor",
      "payment_method",
      "reference_no",
      "amount",
      "project_name",
      "deleted_at",
    ];
    for (const key of editable) {
      if (rest[key] !== undefined) patch[key] = rest[key];
    }
    if (patch.amount !== undefined) patch.amount = +patch.amount;

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("expenses")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;

    return NextResponse.json({ expense: data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// Soft delete by default (?id=...). Add &hard=1 to permanently delete
// (used from the bin).
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const hard = searchParams.get("hard") === "1";
    if (!id)
      return NextResponse.json({ error: "id is required" }, { status: 400 });

    const supabase = getSupabase();

    if (hard) {
      const { error } = await supabase.from("expenses").delete().eq("id", id);
      if (error) throw error;
      return NextResponse.json({ success: true, deleted: true });
    }

    const { error } = await supabase
      .from("expenses")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;

    return NextResponse.json({ success: true, binned: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
