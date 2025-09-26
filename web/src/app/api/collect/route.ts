export async function POST(req: Request) {
  const body = await req.json();
  const r = await fetch(`${process.env.API_BASE_INTERNAL}/collect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return new Response(await r.text(), {
    status: r.status,
    headers: { "Content-Type": "application/json" },
  });
}
