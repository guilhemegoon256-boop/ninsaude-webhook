import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

const REFRESH_TOKEN = process.env.REFRESH_TOKEN;
const ACCOUNT = process.env.ACCOUNT;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "MEU_TOKEN_SECRETO";
const NINSAUDE_API = "https://api.ninsaude.com/v1";
const PORT = process.env.PORT || 3000;

async function getAccessToken() {
  const params = new URLSearchParams();
  params.append("grant_type", "refresh_token");
  params.append("refresh_token", REFRESH_TOKEN);
  params.append("account", ACCOUNT);
  const res = await axios.post(`${NINSAUDE_API}/oauth2/token`, params.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  return res.data.access_token;
}

async function buscarPaciente(token, cpf) {
  const res = await axios.get(
    `${NINSAUDE_API}/cadastro_paciente/listar?filter=${cpf}&property=id`,
    { headers: { Authorization: `bearer ${token}` } }
  );
  return res.data[0]?.id || null;
}

async function cadastrarPaciente(token, nome, cpf) {
  const res = await axios.post(
    `${NINSAUDE_API}/cadastro_paciente`,
    { nome, cpf, ativo: 1 },
    { headers: { Authorization: `bearer ${token}` } }
  );
  return res.data.id || res.data;
}

async function agendar(token, dados) {
  const res = await axios.post(`${NINSAUDE_API}/atendimento_agenda`, dados, {
    headers: { Authorization: `bearer ${token}` },
  });
  return res.data;
}

app.post("/webhook", async (req, res) => {
  const header = req.headers.authorization || "";
  console.log("🔍 Recebido no cabeçalho:", header);
  console.log("🔑 WEBHOOK_SECRET esperado:", `Bearer ${WEBHOOK_SECRET}`);

  if (header !== `Bearer ${WEBHOOK_SECRET}`)
    return res.status(401).json({ erro: "Acesso não autorizado" });


  const { nome, cpf, data, hora, profissionalId, servicoId, especialidadeId, accountUnidade } =
    req.body;

  if (!nome || !cpf || !data || !hora || !profissionalId || !accountUnidade)
    return res.status(400).json({ erro: "Campos obrigatórios faltando" });

  try {
    const token = await getAccessToken();

    let paciente = await buscarPaciente(token, cpf);
    if (!paciente) paciente = await cadastrarPaciente(token, nome, cpf);

    function addMinutos(horaStr, minutos = 30) {
      const [h, m] = horaStr.split(":").map(Number);
      const d = new Date(0, 0, 0, h, m);
      d.setMinutes(d.getMinutes() + minutos);
      return d.toTimeString().split(" ")[0];
    }

    const horaInicial = hora.length === 5 ? `${hora}:00` : hora;
    const horaFinal = addMinutos(hora);

    const agendamento = {
      accountUnidade,
      profissional: profissionalId,
      data,
      horaInicial,
      horaFinal,
      paciente,
      status: 0,
      servico: servicoId || null,
      especialidade: especialidadeId || null,
    };

    const criado = await agendar(token, agendamento);
    return res.json({ sucesso: true, agendamento: criado });
  } catch (err) {
    console.error(err.response?.data || err.message);
    return res.status(500).json({
      erro: "Falha ao criar agendamento",
      detalhes: err.response?.data || err.message,
    });
  }
});

app.listen(PORT, () => console.log(`✅ Webhook rodando na porta ${PORT}`));

