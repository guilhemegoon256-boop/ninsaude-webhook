import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// CONFIG FIXA - AJUSTE PARA SUA REALIDADE
const NINSAUDE_REFRESH_TOKEN = process.env.NINSAUDE_REFRESH_TOKEN;
const ACCOUNT_UNIDADE = 1;     // unidade fixa
const PROFISSIONAL_ID = 3;     // profissional fixo
const SERVICO_ID = 1;          // ex: 1ª Consulta
const ESPECIALIDADE_ID = 1;    // especialidade fixa

// 1) Gera access_token via refresh_token
async function getAccessToken() {
  const data = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: NINSAUDE_REFRESH_TOKEN
  }).toString();

  const res = await axios.post(
    "https://api.ninsaude.com/v1/oauth2/token",
    data,
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );

  return res.data.access_token;
}

// 2) Busca ou cria paciente usando telefone como identificador
async function getOrCreatePaciente(accessToken, nome, telefone) {
  const cleanPhone = (telefone || "").replace(/\D/g, "");

  // tenta localizar por telefone ou nome
  const listRes = await axios.get(
    `https://api.ninsaude.com/v1/cadastro_paciente/listar?filter=${cleanPhone || nome}&property=id,nome,telefone1`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (listRes.data.result && listRes.data.result.length > 0) {
    return listRes.data.result[0].id;
  }

  // se não encontrar, cria sem CPF
  const createRes = await axios.post(
    "https://api.ninsaude.com/v1/cadastro_paciente",
    {
      nome,
      telefone1: cleanPhone || null,
      ativo: 1
    },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  return createRes.data.result.id;
}

// 3) Verifica se horário está disponível para o profissional fixo
async function isHorarioDisponivel(accessToken, data, hora) {
  const url =
    `https://api.ninsaude.com/v1/atendimento_agenda/listar/horario/disponivel/profissional/${PROFISSIONAL_ID}` +
    `/dataInicial/${data}/dataFinal/${data}?accountUnidade=${ACCOUNT_UNIDADE}`;

  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!res.data.result) return false;

  return res.data.result.some(h => h.horaInicial.startsWith(hora));
}

// 4) Cria agendamento
async function criarAgendamento(accessToken, { pacienteId, data, hora }) {
  const [h, m] = hora.split(":").map(Number);
  const end = new Date();
  end.setHours(h);
  end.setMinutes(m + 30);
  const horaFinal = end.toTimeString().slice(0, 8);

  const payload = {
    accountUnidade: ACCOUNT_UNIDADE,
    profissional: PROFISSIONAL_ID,
    data,
    horaInicial: `${hora}:00`,
    horaFinal,
    paciente: pacienteId,
    status: 0,
    servico: SERVICO_ID,
    especialidade: ESPECIALIDADE_ID
  };

  const res = await axios.post(
    "https://api.ninsaude.com/v1/atendimento_agenda",
    payload,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  return res.data;
}

// 5) Endpoint para o NicoChat chamar
app.post("/agendar", async (req, res) => {
  try {
    const { nome, telefone, data, hora } = req.body;

    if (!nome || !data || !hora) {
      return res.status(400).json({
        ok: false,
        message: "Dados incompletos. Informe nome, data e horário."
      });
    }

    const accessToken = await getAccessToken();
    const pacienteId = await getOrCreatePaciente(accessToken, nome, telefone);

    const disponivel = await isHorarioDisponivel(accessToken, data, hora);

    if (!disponivel) {
      return res.status(200).json({
        ok: false,
        message: "Esse horário não está disponível. Por favor, escolha outro."
      });
    }

    const agendamento = await criarAgendamento(accessToken, {
      pacienteId,
      data,
      hora
    });

    return res.status(200).json({
      ok: true,
      message: "Consulta agendada com sucesso.",
      agendamento
    });
  } catch (err) {
    console.error(err.response?.data || err.message);
    return res.status(500).json({
      ok: false,
      message: "Erro ao tentar agendar.",
      detalhe: err.response?.data || err.message
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("Integração rodando na porta " + PORT);
});
