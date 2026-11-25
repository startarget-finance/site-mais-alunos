// Roda sozinha no Netlify a cada formulário enviado (evento "submission-created").
// Cria a negociação + contato no OuTree e anexa as respostas como nota.
//
// Variáveis de ambiente (Netlify > Project configuration > Environment variables):
//   OUTREE_CHAVE        obrigatória  chave da API (otr_...), escopos crm:read e crm:write
//   OUTREE_ESTAGIO_ID   opcional     estágio onde o lead entra (define o pipeline)
//   OUTREE_PIPELINE_ID  opcional     pipeline (entra no 1º estágio) se não houver estágio

const API = "https://api.outree.tech/v1";

const LABELS = {
  compromisso: "Compromisso",
  nome: "Nome",
  whatsapp: "WhatsApp",
  email: "E-mail",
  instagram: "Instagram",
  segmento: "Segmento",
  alunos: "Alunos ativos",
  faturamento: "Faturamento mensal",
};

function telefoneComDDI(v = "") {
  const d = String(v).replace(/\D/g, "");
  if (!d) return "";
  return d.length <= 11 ? "55" + d : d;
}

async function outree(path, chave, body, idem) {
  const res = await fetch(API + path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${chave}`,
      "Content-Type": "application/json",
      ...(idem ? { "Idempotency-Key": idem } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!res.ok) {
    throw new Error(`OuTree ${path} respondeu ${res.status}: ${text.slice(0, 500)}`);
  }
  return json;
}

export const handler = async (event) => {
  const chave = process.env.OUTREE_CHAVE;
  if (!chave) {
    console.error("OUTREE_CHAVE não configurada: lead não enviado ao CRM.");
    return { statusCode: 200, body: "sem chave" };
  }

  const { payload } = JSON.parse(event.body || "{}");
  if (!payload || payload.form_name !== "diagnostico") {
    return { statusCode: 200, body: "ignorado" };
  }
  const d = payload.data || {};
  const telefone = telefoneComDDI(d.whatsapp);
  if (!telefone) {
    console.error("Envio sem WhatsApp, não dá para criar contato:", payload.id);
    return { statusCode: 200, body: "sem telefone" };
  }

  const negociacao = {
    nome: `Diagnóstico – ${d.nome || "Sem nome"}${d.instagram ? " (" + d.instagram + ")" : ""}`,
    contato: {
      telefone,
      nome: d.nome || undefined,
      email: d.email || null,
      empresa: d.instagram || null,
      origem_url: "https://maisalunos.netlify.app",
    },
  };
  if (process.env.OUTREE_ESTAGIO_ID) negociacao.estagio_id = process.env.OUTREE_ESTAGIO_ID;
  else if (process.env.OUTREE_PIPELINE_ID) negociacao.pipeline_id = process.env.OUTREE_PIPELINE_ID;

  try {
    const criada = await outree("/negociacoes", chave, negociacao, `form-${payload.id}`);
    const id = criada?.negociacao?.id;
    if (id) {
      const conteudo =
        "Respostas do formulário de diagnóstico (maisalunos.netlify.app)\n\n" +
        Object.keys(LABELS)
          .filter((k) => d[k])
          .map((k) => `${LABELS[k]}: ${d[k]}`)
          .join("\n");
      await outree("/notas", chave, { negociacao_id: id, conteudo }, `nota-${payload.id}`);
    }
    console.log("Lead criado no OuTree:", id);
    return { statusCode: 200, body: "ok" };
  } catch (e) {
    console.error(e.message);
    // 200 mesmo assim: a resposta continua salva em Netlify > Forms.
    return { statusCode: 200, body: "erro no CRM" };
  }
};
