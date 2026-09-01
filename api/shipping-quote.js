const ORIGIN_CEP = "29172000";
const PACKAGE = {
  width: 26,
  length: 36,
  height: 1,
  weight: 0.1
};

function cleanCep(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

function parseMoney(value) {
  if (typeof value === "number") return value;
  const raw = String(value ?? "").trim();
  if (!raw) return NaN;
  if (raw.includes(",")) {
    return Number(raw.replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, ""));
  }
  return Number(raw.replace(/[^\d.-]/g, ""));
}

function normalizeOption(item) {
  const price = parseMoney(
    item.price ?? item.custom_price ?? item.discount_price ?? item.total_price ?? item.valor
  );
  if (!Number.isFinite(price) || price < 0 || item.error) return null;

  const id = String(
    item.id ?? item.service_id ?? item.service?.id ?? item.code ?? item.codigo ?? ""
  );

  const name =
    item.name ??
    item.service?.name ??
    item.service_name ??
    item.description ??
    (id ? `Serviço ${id}` : "Entrega");

  const company =
    item.company?.name ??
    item.company_name ??
    item.carrier?.name ??
    "";

  return {
    id,
    name: String(name),
    company: String(company || ""),
    price: Number(price.toFixed(2)),
    delivery_time: Number(item.delivery_time ?? item.deadline ?? item.prazo ?? 0) || null,
    delivery_range: item.delivery_range
      ? {
          min: Number(item.delivery_range.min || 0) || null,
          max: Number(item.delivery_range.max || 0) || null
        }
      : null
  };
}

async function getQuote(postalCode) {
  const token = process.env.SUPERFRETE_TOKEN;
  if (!token) throw new Error("SUPERFRETE_TOKEN não configurado na Vercel.");

  const base = (process.env.SUPERFRETE_API_BASE || "https://api.superfrete.com").replace(/\/$/, "");
  const response = await fetch(`${base}/api/v0/calculator`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "JLMAKEUP/1.0 (jlmakeup_oficial)",
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: { postal_code: ORIGIN_CEP },
      to: { postal_code: postalCode },
      services: "1,2,17,3,33",
      options: {
        own_hand: false,
        receipt: false,
        insurance_value: 0,
        use_insurance_value: false
      },
      package: PACKAGE
    })
  });

  let data;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    console.error("SuperFrete:", response.status, data);
    throw new Error(
      data?.message || data?.error || `A SuperFrete recusou a cotação (HTTP ${response.status}).`
    );
  }

  const source = Array.isArray(data)
    ? data
    : Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.services)
        ? data.services
        : [];

  return source.map(normalizeOption).filter(Boolean);
}

function getBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método não permitido." });
  }

  try {
    const body = getBody(req);
    const postalCode = cleanCep(body.postal_code);

    if (postalCode.length !== 8) {
      return res.status(400).json({ error: "CEP de destino inválido." });
    }

    const options = await getQuote(postalCode);

    if (!options.length) {
      return res.status(404).json({
        error: "Nenhuma modalidade de frete disponível para esse CEP.",
        options: []
      });
    }

    return res.status(200).json({
      origin_postal_code: ORIGIN_CEP,
      package: PACKAGE,
      options
    });
  } catch (error) {
    console.error(error);
    return res.status(502).json({ error: error.message || "Erro ao calcular o frete." });
  }
}

module.exports = handler;
module.exports.getQuote = getQuote;
