"use strict";

const bcrypt = require("bcryptjs");

const DEMO_PASSWORD = "DelBicos@2026";

const PROVIDERS = [
  {
    category: "Saúde & Bem-Estar",
    name: "Helena Martins",
    email: "catalogo.saude.helena@demo.delbicos.local",
    phone: "5511988100001",
    cpf: "91000000001",
    description:
      "Profissional de saúde e bem-estar com atendimento humanizado em domicílio, planejamento individual e acompanhamento cuidadoso de cada cliente.",
    serviceRadiusKm: 12,
    days: [1, 2, 3, 4, 5],
    start: "08:00:00",
    end: "17:00:00",
    address: [
      "Avenida Barão de Tatuí",
      "950",
      "Jardim Vergueiro",
      "Sorocaba",
      "SP",
      "18030000",
      -23.5102,
      -47.4612,
    ],
  },
  {
    category: "Saúde & Bem-Estar",
    name: "Rafael Nogueira",
    email: "catalogo.saude.rafael@demo.delbicos.local",
    phone: "5511988100002",
    cpf: "91000000002",
    description:
      "Especialista em qualidade de vida, prevenção e reabilitação, com atendimentos personalizados para diferentes faixas etárias.",
    serviceRadiusKm: 18,
    days: [0, 2, 3, 4, 5, 6],
    start: "10:00:00",
    end: "19:00:00",
    address: [
      "Rua da Penha",
      "780",
      "Centro",
      "Sorocaba",
      "SP",
      "18010000",
      -23.5019,
      -47.459,
    ],
  },
  {
    category: "Beleza & Estética",
    name: "Camila Fernandes",
    email: "catalogo.beleza.camila@demo.delbicos.local",
    phone: "5511988100003",
    cpf: "91000000003",
    description:
      "Profissional de beleza com foco em técnicas atuais, biossegurança e atendimento personalizado no conforto da residência do cliente.",
    serviceRadiusKm: 10,
    days: [2, 3, 4, 5, 6],
    start: "09:00:00",
    end: "18:00:00",
    address: [
      "Avenida Washington Luiz",
      "1220",
      "Parque Campolim",
      "Sorocaba",
      "SP",
      "18047320",
      -23.5224,
      -47.4698,
    ],
  },
  {
    category: "Beleza & Estética",
    name: "Bruno Azevedo",
    email: "catalogo.beleza.bruno@demo.delbicos.local",
    phone: "5511988100004",
    cpf: "91000000004",
    description:
      "Especialista em estética, imagem pessoal e cuidados masculinos e femininos, com materiais profissionais e protocolos de higiene.",
    serviceRadiusKm: 14,
    days: [0, 1, 2, 3, 4, 5, 6],
    start: "10:00:00",
    end: "20:00:00",
    address: [
      "Rua Mascarenhas Camelo",
      "610",
      "Vila Santana",
      "Sorocaba",
      "SP",
      "18080105",
      -23.4938,
      -47.4635,
    ],
  },
  {
    category: "Reformas & Reparos",
    name: "Marcos Ribeiro",
    email: "catalogo.reformas.marcos@demo.delbicos.local",
    phone: "5511988100005",
    cpf: "91000000005",
    description:
      "Técnico de reformas residenciais com experiência em instalações, manutenção preventiva e reparos emergenciais de pequeno e médio porte.",
    serviceRadiusKm: 25,
    days: [1, 2, 3, 4, 5, 6],
    start: "07:00:00",
    end: "18:00:00",
    address: [
      "Avenida General Carneiro",
      "1450",
      "Vila Lucy",
      "Sorocaba",
      "SP",
      "18043003",
      -23.5064,
      -47.4802,
    ],
  },
  {
    category: "Reformas & Reparos",
    name: "Diego Carvalho",
    email: "catalogo.reformas.diego@demo.delbicos.local",
    phone: "5511988100006",
    cpf: "91000000006",
    description:
      "Profissional de obras e acabamento, reconhecido pela organização do canteiro, orçamento transparente e cumprimento de prazos.",
    serviceRadiusKm: 30,
    days: [1, 2, 3, 4, 5],
    start: "08:00:00",
    end: "17:00:00",
    address: [
      "Rua Aparecida",
      "1020",
      "Jardim Santa Rosália",
      "Sorocaba",
      "SP",
      "18090110",
      -23.4917,
      -47.4487,
    ],
  },
  {
    category: "Serviços Gerais",
    name: "Larissa Monteiro",
    email: "catalogo.gerais.larissa@demo.delbicos.local",
    phone: "5511988100007",
    cpf: "91000000007",
    description:
      "Prestadora versátil para apoio residencial e eventos, com atendimento pontual, comunicação clara e soluções sob medida.",
    serviceRadiusKm: 22,
    days: [1, 2, 3, 4, 5, 6],
    start: "08:00:00",
    end: "18:00:00",
    address: [
      "Avenida São João",
      "860",
      "Jardim Icatu",
      "Votorantim",
      "SP",
      "18110520",
      -23.5381,
      -47.4504,
    ],
  },
  {
    category: "Serviços Gerais",
    name: "André Vasconcelos",
    email: "catalogo.gerais.andre@demo.delbicos.local",
    phone: "5511988100008",
    cpf: "91000000008",
    description:
      "Profissional de serviços gerais com experiência em logística, montagem e atendimento a demandas residenciais e comerciais.",
    serviceRadiusKm: 35,
    days: [0, 3, 4, 5, 6],
    start: "10:00:00",
    end: "20:00:00",
    address: [
      "Avenida 31 de Março",
      "540",
      "Centro",
      "Votorantim",
      "SP",
      "18110005",
      -23.5418,
      -47.4405,
    ],
  },
  {
    category: "Serviços Domésticos",
    name: "Sônia Almeida",
    email: "catalogo.domesticos.sonia@demo.delbicos.local",
    phone: "5511988100009",
    cpf: "91000000009",
    description:
      "Profissional de cuidados domésticos com referências, atenção aos detalhes e rotinas adaptadas às necessidades de cada família.",
    serviceRadiusKm: 15,
    days: [1, 2, 3, 4, 5],
    start: "07:00:00",
    end: "16:00:00",
    address: [
      "Rua João Wagner Wey",
      "720",
      "Jardim América",
      "Sorocaba",
      "SP",
      "18046000",
      -23.5168,
      -47.4741,
    ],
  },
  {
    category: "Serviços Domésticos",
    name: "Paulo Mendes",
    email: "catalogo.domesticos.paulo@demo.delbicos.local",
    phone: "5511988100010",
    cpf: "91000000010",
    description:
      "Especialista em manutenção e organização doméstica, com equipamentos próprios e atendimento também aos fins de semana.",
    serviceRadiusKm: 20,
    days: [0, 2, 3, 4, 5, 6],
    start: "08:00:00",
    end: "17:00:00",
    address: [
      "Avenida Engenheiro Carlos Reinaldo Mendes",
      "1850",
      "Alto da Boa Vista",
      "Sorocaba",
      "SP",
      "18013280",
      -23.4936,
      -47.4308,
    ],
  },
  {
    category: "Pet",
    name: "Isabela Freitas",
    email: "catalogo.pet.isabela@demo.delbicos.local",
    phone: "5511988100011",
    cpf: "91000000011",
    description:
      "Cuidadora pet com manejo gentil, experiência com cães e gatos e atualização diária para os tutores durante cada atendimento.",
    serviceRadiusKm: 16,
    days: [1, 2, 3, 4, 5, 6],
    start: "08:00:00",
    end: "19:00:00",
    address: [
      "Rua Monteiro Lobato",
      "430",
      "Vila Hortência",
      "Sorocaba",
      "SP",
      "18020200",
      -23.5089,
      -47.4357,
    ],
  },
  {
    category: "Pet",
    name: "Gustavo Peixoto",
    email: "catalogo.pet.gustavo@demo.delbicos.local",
    phone: "5511988100012",
    cpf: "91000000012",
    description:
      "Profissional de cuidados animais com foco em segurança, bem-estar e rotinas personalizadas para pets de diferentes portes.",
    serviceRadiusKm: 24,
    days: [0, 2, 3, 4, 5, 6],
    start: "09:00:00",
    end: "18:00:00",
    address: [
      "Rua Antônio Perez Hernandez",
      "880",
      "Parque Campolim",
      "Sorocaba",
      "SP",
      "18048005",
      -23.5262,
      -47.4765,
    ],
  },
];

const CATALOG = {
  "Saúde & Bem-Estar": [
    [
      "Enfermeiro(a)",
      "Atendimento de enfermagem domiciliar",
      16000,
      90,
      "Avaliação de sinais vitais, administração de medicamentos prescritos e cuidados de enfermagem no domicílio.",
    ],
    [
      "Psicólogo(a)",
      "Sessão de psicoterapia individual",
      18000,
      50,
      "Sessão individual de acolhimento e acompanhamento psicológico, presencial e com abordagem centrada no cliente.",
    ],
    [
      "Cuidador de Idoso",
      "Acompanhamento de pessoa idosa",
      22000,
      240,
      "Acompanhamento com apoio à rotina, alimentação, mobilidade e companhia, respeitando as orientações da família.",
    ],
    [
      "Terapeuta Ocupacional",
      "Terapia ocupacional em domicílio",
      19000,
      60,
      "Avaliação funcional e atividades terapêuticas para ampliar autonomia e segurança nas tarefas diárias.",
    ],
    [
      "Doula",
      "Acompanhamento pré-parto com doula",
      25000,
      120,
      "Encontro de preparação para parto e pós-parto, com informação, escuta e técnicas não farmacológicas de conforto.",
    ],
    [
      "Massoterapeuta",
      "Massagem terapêutica relaxante",
      14000,
      60,
      "Massagem corporal voltada ao relaxamento, alívio de tensão muscular e promoção de bem-estar.",
    ],
    [
      "Nutricionista",
      "Consulta nutricional personalizada",
      17000,
      60,
      "Avaliação de hábitos, objetivos e rotina para elaboração de orientação alimentar individualizada.",
    ],
    [
      "Fonoaudiólogo(a)",
      "Avaliação fonoaudiológica domiciliar",
      18500,
      60,
      "Avaliação de fala, voz, linguagem ou deglutição, com orientações e plano inicial de acompanhamento.",
    ],
    [
      "Personal Trainer",
      "Treino funcional personalizado",
      12000,
      60,
      "Sessão de treino adaptada ao condicionamento, aos objetivos e aos recursos disponíveis no local.",
    ],
  ],
  "Beleza & Estética": [
    [
      "Cabelo & Barba",
      "Corte de cabelo e acabamento de barba",
      9000,
      75,
      "Corte personalizado, desenho e acabamento de barba com higienização dos materiais.",
    ],
    [
      "Manicure & Pedicure",
      "Manicure e pedicure completas",
      8500,
      90,
      "Cuidados completos para mãos e pés, incluindo cutilagem, lixamento e esmaltação tradicional.",
    ],
    [
      "Maquiagem",
      "Maquiagem social profissional",
      16000,
      90,
      "Maquiagem personalizada para eventos, com preparação de pele e acabamento de longa duração.",
    ],
    [
      "Manicure",
      "Manicure com esmaltação",
      5000,
      50,
      "Cuidado das unhas das mãos com cutilagem, lixamento e esmaltação em cor escolhida pela cliente.",
    ],
    [
      "Depilação",
      "Depilação corporal com cera",
      11000,
      75,
      "Depilação com técnica cuidadosa, materiais descartáveis e finalização calmante para a pele.",
    ],
    [
      "Esteticista",
      "Limpeza de pele profunda",
      15000,
      90,
      "Higienização, esfoliação, extração e hidratação facial conforme avaliação prévia da pele.",
    ],
    [
      "Micropigmentação",
      "Micropigmentação de sobrancelhas",
      42000,
      150,
      "Design e pigmentação fio a fio, com análise de simetria, teste de cor e orientações de recuperação.",
    ],
    [
      "Podologia",
      "Sessão de podologia preventiva",
      13000,
      60,
      "Cuidados preventivos dos pés, corte técnico das unhas e tratamento básico de calosidades.",
    ],
    [
      "Design de Sobrancelhas",
      "Design e correção de sobrancelhas",
      6500,
      45,
      "Mapeamento facial, modelagem e correção para valorizar o formato natural das sobrancelhas.",
    ],
    [
      "Massagem Modeladora",
      "Massagem modeladora corporal",
      14500,
      60,
      "Sessão com manobras modeladoras e drenantes, realizada após avaliação das áreas de tratamento.",
    ],
  ],
  "Reformas & Reparos": [
    [
      "Chaveiro",
      "Abertura e troca de segredo residencial",
      14000,
      60,
      "Abertura técnica de porta e troca de segredo de fechadura comum, com teste completo de funcionamento.",
    ],
    [
      "Eletricista",
      "Instalação de tomadas e luminárias",
      18000,
      120,
      "Instalação segura de até três pontos elétricos, com verificação de tensão e testes ao final.",
    ],
    [
      "Encanador",
      "Reparo de vazamento hidráulico",
      17000,
      120,
      "Localização e correção de vazamento aparente em torneira, sifão, registro ou tubulação acessível.",
    ],
    [
      "Gás & Água",
      "Revisão de instalação de gás e água",
      24000,
      150,
      "Inspeção de conexões, registros e pontos aparentes, com testes de estanqueidade e funcionamento.",
    ],
    [
      "Limpeza pós Obra",
      "Limpeza completa pós-obra",
      48000,
      360,
      "Remoção de poeira fina, respingos e resíduos leves, com limpeza detalhada de pisos e superfícies.",
    ],
    [
      "Marido de Aluguel",
      "Pacote de pequenos reparos residenciais",
      20000,
      180,
      "Execução de pequenos reparos, fixações e ajustes domésticos reunidos em uma única visita.",
    ],
    [
      "Designer de Interiores",
      "Consultoria de interiores com layout",
      35000,
      150,
      "Consultoria para organização do ambiente, definição de layout, cores, iluminação e lista de prioridades.",
    ],
    [
      "Marceneiro",
      "Ajuste e reparo de móveis",
      23000,
      180,
      "Regulagem de portas e gavetas, reforço de estruturas e pequenos reparos em móveis de madeira ou MDF.",
    ],
    [
      "Pedreiro",
      "Reparo de alvenaria e revestimento",
      38000,
      300,
      "Correção localizada de parede, reboco ou revestimento, com preparação e acabamento da área reparada.",
    ],
    [
      "Pintor",
      "Pintura de cômodo residencial",
      55000,
      480,
      "Preparação leve e pintura de paredes de um cômodo padrão, incluindo proteção básica do ambiente.",
    ],
    [
      "Vidraceiro",
      "Instalação de vidro sob medida",
      32000,
      180,
      "Medição, ajuste e instalação de peça de vidro comum em janela, porta, prateleira ou tampo.",
    ],
    [
      "Serralheiro",
      "Reparo de portão e estrutura metálica",
      28000,
      180,
      "Solda, alinhamento e reforço localizado em portões, grades ou pequenas estruturas metálicas.",
    ],
    [
      "Gesseiro",
      "Reparo de gesso e drywall",
      26000,
      240,
      "Correção de trincas, furos e pequenas áreas de gesso ou drywall, pronta para receber pintura.",
    ],
  ],
  "Serviços Gerais": [
    [
      "Corte & Costura",
      "Ajuste de roupas sob medida",
      8000,
      90,
      "Ajuste de barra, cintura ou modelagem simples em até duas peças, após prova e marcação.",
    ],
    [
      "Sapateiro",
      "Reparo e restauração de calçados",
      7000,
      90,
      "Troca de salto ou sola, colagem e acabamento básico conforme avaliação do calçado.",
    ],
    [
      "Desentupidor",
      "Desentupimento de pia ou ralo",
      19000,
      120,
      "Desobstrução mecânica de pia ou ralo residencial, com teste de escoamento após o serviço.",
    ],
    [
      "Mudanças & Carretos",
      "Carreto urbano de pequeno porte",
      32000,
      180,
      "Transporte urbano de volumes e pequenos móveis, com organização e proteção básica da carga.",
    ],
    [
      "Recepcionista",
      "Recepção para evento",
      24000,
      240,
      "Credenciamento, orientação de convidados e apoio à organização durante evento de pequeno porte.",
    ],
    [
      "Fotógrafo",
      "Ensaio fotográfico externo",
      38000,
      120,
      "Ensaio de até duas horas em uma locação, com seleção e tratamento digital das melhores imagens.",
    ],
    [
      "Animador de Festa",
      "Recreação para festa infantil",
      30000,
      180,
      "Brincadeiras, jogos e atividades conduzidas de acordo com a faixa etária e o espaço do evento.",
    ],
    [
      "Motorista",
      "Motorista particular por período",
      26000,
      240,
      "Condução segura em veículo do cliente por até quatro horas dentro da área de atendimento.",
    ],
    [
      "Montador de Móveis",
      "Montagem de móvel residencial",
      21000,
      180,
      "Montagem de guarda-roupa, cômoda, mesa ou móvel equivalente conforme manual do fabricante.",
    ],
    [
      "Dedetizador",
      "Controle de pragas residencial",
      29000,
      150,
      "Aplicação técnica para controle de insetos rasteiros em residência, com orientações de segurança.",
    ],
  ],
  "Serviços Domésticos": [
    [
      "Babá",
      "Cuidados infantis por período",
      20000,
      240,
      "Acompanhamento de uma criança por até quatro horas, incluindo alimentação e atividades combinadas com a família.",
    ],
    [
      "Cozinheira",
      "Preparo de refeições da semana",
      26000,
      300,
      "Planejamento e preparo de refeições caseiras para a semana com ingredientes fornecidos pelo cliente.",
    ],
    [
      "Diarista",
      "Faxina residencial completa",
      22000,
      360,
      "Limpeza geral de apartamento ou casa de pequeno porte, incluindo cozinha, banheiros e áreas comuns.",
    ],
    [
      "Jardineiro",
      "Manutenção de jardim residencial",
      19000,
      180,
      "Poda leve, retirada de folhas, controle manual de ervas e organização geral do jardim.",
    ],
    [
      "Lavadeira",
      "Lavagem e organização de roupas",
      16000,
      240,
      "Separação, lavagem e organização de roupas conforme etiquetas e produtos disponíveis na residência.",
    ],
    [
      "Limpeza de sofá",
      "Higienização de sofá",
      25000,
      180,
      "Aspiração, aplicação de produto e extração para higienização de sofá de até três lugares.",
    ],
    [
      "Passadeira",
      "Passadoria de roupas por período",
      15000,
      240,
      "Passadoria e dobra de roupas por até quatro horas, com separação por pessoa ou tipo de peça.",
    ],
    [
      "Personal Organizer",
      "Organização funcional de ambiente",
      28000,
      240,
      "Triagem e organização de armário, cozinha ou despensa com soluções práticas para manutenção da rotina.",
    ],
    [
      "Sanitização de Ambientes",
      "Sanitização residencial",
      23000,
      120,
      "Aplicação de produto sanitizante em superfícies e pontos de contato de ambiente residencial.",
    ],
    [
      "Piscineiro",
      "Limpeza e tratamento de piscina",
      18000,
      120,
      "Aspiração, peneiração, escovação e verificação básica dos parâmetros da água da piscina.",
    ],
  ],
  Pet: [
    [
      "Pet Sitter",
      "Visita de cuidados para pet",
      9000,
      60,
      "Visita domiciliar para alimentação, higiene básica, medicação oral prescrita e companhia ao animal.",
    ],
    [
      "Dog Walker",
      "Passeio individual com cão",
      6000,
      45,
      "Passeio individual no ritmo do animal, com água, condução segura e atualização enviada ao tutor.",
    ],
    [
      "Veterinário",
      "Consulta veterinária domiciliar",
      22000,
      60,
      "Avaliação clínica geral no domicílio, com orientações e encaminhamento quando forem necessários exames.",
    ],
    [
      "Creche & Hotel",
      "Hospedagem diária para pet",
      14000,
      720,
      "Diária de hospedagem com rotina supervisionada, alimentação fornecida pelo tutor e momentos de recreação.",
    ],
    [
      "Banho & Tosa",
      "Banho e tosa higiênica",
      11000,
      120,
      "Banho com produtos adequados, secagem, escovação, corte de unhas e tosa higiênica.",
    ],
    [
      "Adestrador",
      "Aula de adestramento positivo",
      15000,
      60,
      "Sessão individual baseada em reforço positivo para comandos básicos e manejo de comportamentos cotidianos.",
    ],
  ],
};

const DEMO_EMAILS = PROVIDERS.map((provider) => provider.email);
const REQUIRED_CATEGORY_TITLES = Object.keys(CATALOG);
const REVIEW_TEMPLATES = [
  {
    rating: 5,
    text: "Atendimento pontual, cuidadoso e com ótima comunicação. Recomendo!",
  },
  {
    rating: 4,
    text: "Serviço muito bem executado e todas as orientações foram explicadas com clareza.",
  },
];
const DEMO_REVIEW_PAYMENT_IDS = PROVIDERS.flatMap((_, providerIndex) =>
  REVIEW_TEMPLATES.map(
    (_, reviewIndex) =>
      `pi_catalog_demo_${providerIndex + 1}_${reviewIndex + 1}`,
  ),
);

function weeklyMask(days) {
  return Array.from({ length: 7 }, (_, day) =>
    days.includes(day) ? "1" : "0",
  ).join("");
}

async function selectRows(
  queryInterface,
  Sequelize,
  sql,
  replacements,
  transaction,
) {
  return queryInterface.sequelize.query(sql, {
    replacements,
    type: Sequelize.QueryTypes.SELECT,
    transaction,
  });
}

function requireUniqueRows(rows, keyFactory, description) {
  const grouped = new Map();
  for (const row of rows) {
    const key = keyFactory(row);
    grouped.set(key, (grouped.get(key) || 0) + 1);
  }
  const duplicates = [...grouped.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => key);
  if (duplicates.length > 0) {
    throw new Error(`${description} duplicados: ${duplicates.join(", ")}.`);
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const now = new Date();
      const catalogEntries = Object.entries(CATALOG).flatMap(
        ([category, services]) =>
          services.map(
            (
              [subcategory, title, priceCents, duration, description],
              index,
            ) => ({
              category,
              subcategory,
              title,
              priceCents,
              duration,
              description,
              providerSlot: index % 2,
            }),
          ),
      );

      if (catalogEntries.length !== 58) {
        throw new Error(
          `Catálogo demo inválido: esperados 58 serviços, encontrados ${catalogEntries.length}.`,
        );
      }

      const categories = await selectRows(
        queryInterface,
        Sequelize,
        `SELECT id, title FROM category WHERE title IN (:titles)`,
        { titles: REQUIRED_CATEGORY_TITLES },
        transaction,
      );
      requireUniqueRows(
        categories,
        (row) => row.title,
        "Categorias principais",
      );
      const categoryByTitle = new Map(
        categories.map((row) => [row.title, Number(row.id)]),
      );
      const missingCategories = REQUIRED_CATEGORY_TITLES.filter(
        (title) => !categoryByTitle.has(title),
      );
      if (missingCategories.length > 0) {
        throw new Error(
          `Categorias principais ausentes: ${missingCategories.join(", ")}. Execute os seeders de categorias antes deste catálogo.`,
        );
      }

      const subcategories = await selectRows(
        queryInterface,
        Sequelize,
        `SELECT s.id, s.title, s.category_id, c.title AS category_title
         FROM subcategory s
         INNER JOIN category c ON c.id = s.category_id
         WHERE c.title IN (:titles)`,
        { titles: REQUIRED_CATEGORY_TITLES },
        transaction,
      );
      const subcategoryKey = (category, subcategory) =>
        `${category}|${subcategory}`;
      requireUniqueRows(
        subcategories,
        (row) => subcategoryKey(row.category_title, row.title),
        "Subcategorias",
      );
      const subcategoryByKey = new Map(
        subcategories.map((row) => [
          subcategoryKey(row.category_title, row.title),
          row,
        ]),
      );
      const missingSubcategories = catalogEntries
        .filter(
          (entry) =>
            !subcategoryByKey.has(
              subcategoryKey(entry.category, entry.subcategory),
            ),
        )
        .map((entry) => `${entry.category} > ${entry.subcategory}`);
      if (missingSubcategories.length > 0) {
        throw new Error(
          `Subcategorias necessárias ausentes: ${missingSubcategories.join(", ")}. Execute os seeders de subcategorias antes deste catálogo.`,
        );
      }

      const existingUsers = await selectRows(
        queryInterface,
        Sequelize,
        `SELECT id, name, email, phone FROM users WHERE email IN (:emails)`,
        { emails: DEMO_EMAILS },
        transaction,
      );
      requireUniqueRows(existingUsers, (row) => row.email, "Usuários demo");
      const existingUserByEmail = new Map(
        existingUsers.map((row) => [row.email, row]),
      );
      for (const provider of PROVIDERS) {
        const existing = existingUserByEmail.get(provider.email);
        if (
          existing &&
          (existing.name !== provider.name || existing.phone !== provider.phone)
        ) {
          throw new Error(
            `O e-mail técnico ${provider.email} já pertence a outro usuário; o catálogo demo não pode reutilizá-lo.`,
          );
        }
      }

      const missingProviders = PROVIDERS.filter(
        (provider) => !existingUserByEmail.has(provider.email),
      );
      if (missingProviders.length > 0) {
        const password = await bcrypt.hash(DEMO_PASSWORD, 10);
        await queryInterface.bulkInsert(
          "users",
          missingProviders.map((provider, index) => ({
            name: provider.name,
            email: provider.email,
            phone: provider.phone,
            password,
            active: true,
            avatar_uri: `https://i.pravatar.cc/300?img=${index + 21}`,
            banner_uri: `https://picsum.photos/seed/delbicos-profissional-${index + 1}/1200/480`,
            created_at: now,
            updated_at: now,
          })),
          { transaction },
        );
      }

      const users = await selectRows(
        queryInterface,
        Sequelize,
        `SELECT id, email FROM users WHERE email IN (:emails)`,
        { emails: DEMO_EMAILS },
        transaction,
      );
      const userByEmail = new Map(
        users.map((row) => [row.email, Number(row.id)]),
      );
      const missingUsersAfterInsert = DEMO_EMAILS.filter(
        (email) => !userByEmail.has(email),
      );
      if (missingUsersAfterInsert.length > 0) {
        throw new Error(
          `Falha ao localizar usuários demo após inserção: ${missingUsersAfterInsert.join(", ")}.`,
        );
      }

      const userIds = [...userByEmail.values()];
      const addresses = await selectRows(
        queryInterface,
        Sequelize,
        `SELECT id, user_id, street, number, postal_code FROM address WHERE user_id IN (:userIds)`,
        { userIds },
        transaction,
      );
      const addressByEmail = new Map();
      for (const provider of PROVIDERS) {
        const userId = userByEmail.get(provider.email);
        const [street, number, , , , postalCode] = provider.address;
        const matches = addresses.filter(
          (row) =>
            Number(row.user_id) === userId &&
            row.street === street &&
            row.number === number &&
            row.postal_code === postalCode,
        );
        if (matches.length > 1) {
          throw new Error(`Endereço demo duplicado para ${provider.email}.`);
        }
        if (matches.length === 1)
          addressByEmail.set(provider.email, Number(matches[0].id));
      }

      const providersWithoutAddress = PROVIDERS.filter(
        (provider) => !addressByEmail.has(provider.email),
      );
      if (providersWithoutAddress.length > 0) {
        await queryInterface.bulkInsert(
          "address",
          providersWithoutAddress.map((provider) => {
            const [
              street,
              number,
              neighborhood,
              city,
              state,
              postalCode,
              lat,
              lng,
            ] = provider.address;
            return {
              user_id: userByEmail.get(provider.email),
              lat,
              lng,
              street,
              number,
              complement: null,
              neighborhood,
              city,
              state,
              country_iso: "BR",
              postal_code: postalCode,
              active: true,
              created_at: now,
              updated_at: now,
            };
          }),
          { transaction },
        );
      }

      const allAddresses = await selectRows(
        queryInterface,
        Sequelize,
        `SELECT id, user_id, street, number, postal_code FROM address WHERE user_id IN (:userIds)`,
        { userIds },
        transaction,
      );
      for (const provider of PROVIDERS) {
        const userId = userByEmail.get(provider.email);
        const [street, number, , , , postalCode] = provider.address;
        const matches = allAddresses.filter(
          (row) =>
            Number(row.user_id) === userId &&
            row.street === street &&
            row.number === number &&
            row.postal_code === postalCode,
        );
        if (matches.length !== 1) {
          throw new Error(
            `Esperado um endereço demo para ${provider.email}; encontrados ${matches.length}.`,
          );
        }
        addressByEmail.set(provider.email, Number(matches[0].id));
      }

      const existingProfessionals = await selectRows(
        queryInterface,
        Sequelize,
        `SELECT id, user_id, cpf FROM professional WHERE user_id IN (:userIds)`,
        { userIds },
        transaction,
      );
      requireUniqueRows(
        existingProfessionals,
        (row) => Number(row.user_id),
        "Perfis profissionais demo",
      );
      const professionalByUserId = new Map(
        existingProfessionals.map((row) => [Number(row.user_id), row]),
      );
      for (const provider of PROVIDERS) {
        const existing = professionalByUserId.get(
          userByEmail.get(provider.email),
        );
        if (existing && existing.cpf !== provider.cpf) {
          throw new Error(
            `O usuário ${provider.email} já possui perfil profissional com outro CPF.`,
          );
        }
      }

      const professionalsToInsert = PROVIDERS.filter(
        (provider) =>
          !professionalByUserId.has(userByEmail.get(provider.email)),
      );
      if (professionalsToInsert.length > 0) {
        await queryInterface.bulkInsert(
          "professional",
          professionalsToInsert.map((provider) => ({
            user_id: userByEmail.get(provider.email),
            main_address_id: addressByEmail.get(provider.email),
            description: provider.description,
            cpf: provider.cpf,
            cnpj: null,
            service_radius_km: provider.serviceRadiusKm,
            created_at: now,
            updated_at: now,
          })),
          { transaction },
        );
      }

      const professionals = await selectRows(
        queryInterface,
        Sequelize,
        `SELECT p.id, p.user_id, u.email
         FROM professional p
         INNER JOIN users u ON u.id = p.user_id
         WHERE u.email IN (:emails)`,
        { emails: DEMO_EMAILS },
        transaction,
      );
      const professionalByEmail = new Map(
        professionals.map((row) => [row.email, Number(row.id)]),
      );
      for (const provider of PROVIDERS) {
        const professionalId = professionalByEmail.get(provider.email);
        if (!professionalId)
          throw new Error(
            `Perfil profissional demo não encontrado para ${provider.email}.`,
          );
        await queryInterface.bulkUpdate(
          "professional",
          {
            main_address_id: addressByEmail.get(provider.email),
            description: provider.description,
            service_radius_km: provider.serviceRadiusKm,
            updated_at: now,
          },
          { id: professionalId },
          { transaction },
        );
      }

      const professionalIds = [...professionalByEmail.values()];
      await queryInterface.bulkDelete(
        "professional_availability",
        { professional_id: { [Sequelize.Op.in]: professionalIds } },
        { transaction },
      );
      await queryInterface.bulkInsert(
        "professional_availability",
        PROVIDERS.map((provider) => ({
          professional_id: professionalByEmail.get(provider.email),
          days_of_week: weeklyMask(provider.days),
          start_day_of_month: null,
          end_day_of_month: null,
          start_day: null,
          end_day: null,
          start_time: provider.start,
          end_time: provider.end,
          is_available: true,
          recurrence_pattern: "weekly",
          created_at: now,
          updated_at: now,
        })),
        { transaction },
      );

      const providersByCategory = new Map(
        REQUIRED_CATEGORY_TITLES.map((category) => [
          category,
          PROVIDERS.filter((provider) => provider.category === category),
        ]),
      );
      for (const [category, categoryProviders] of providersByCategory) {
        if (categoryProviders.length !== 2) {
          throw new Error(
            `A categoria ${category} deve possuir exatamente dois prestadores demo.`,
          );
        }
      }

      const desiredServices = catalogEntries.map((entry, index) => {
        const provider = providersByCategory.get(entry.category)[
          entry.providerSlot
        ];
        const subcategory = subcategoryByKey.get(
          subcategoryKey(entry.category, entry.subcategory),
        );
        return {
          ...entry,
          professionalId: professionalByEmail.get(provider.email),
          categoryId: categoryByTitle.get(entry.category),
          subcategoryId: Number(subcategory.id),
          bannerUri: `https://picsum.photos/seed/delbicos-servico-${index + 1}/1200/675`,
        };
      });

      const existingServices = await selectRows(
        queryInterface,
        Sequelize,
        `SELECT id, professional_id, subcategory_id, title FROM service WHERE professional_id IN (:professionalIds)`,
        { professionalIds },
        transaction,
      );
      requireUniqueRows(
        existingServices,
        (row) => `${row.professional_id}|${row.title}`,
        "Serviços demo",
      );
      const existingServiceByKey = new Map(
        existingServices.map((row) => [
          `${Number(row.professional_id)}|${row.title}`,
          row,
        ]),
      );
      const servicesToInsert = [];
      for (const service of desiredServices) {
        const key = `${service.professionalId}|${service.title}`;
        const existing = existingServiceByKey.get(key);
        if (
          existing &&
          Number(existing.subcategory_id) !== service.subcategoryId
        ) {
          throw new Error(
            `O serviço demo "${service.title}" está vinculado a uma subcategoria inesperada.`,
          );
        }
        const values = {
          title: service.title,
          description: service.description,
          price: (service.priceCents / 100).toFixed(2),
          price_cents: service.priceCents,
          duration: service.duration,
          date: null,
          active: true,
          category_id: service.categoryId,
          subcategory_id: service.subcategoryId,
          professional_id: service.professionalId,
          banner_uri: service.bannerUri,
          updated_at: now,
        };
        if (existing) {
          await queryInterface.bulkUpdate(
            "service",
            values,
            { id: Number(existing.id) },
            { transaction },
          );
        } else {
          servicesToInsert.push({ ...values, created_at: now });
        }
      }
      if (servicesToInsert.length > 0) {
        await queryInterface.bulkInsert("service", servicesToInsert, {
          transaction,
        });
      }

      const seededServices = await selectRows(
        queryInterface,
        Sequelize,
        `SELECT id, professional_id, title FROM service WHERE professional_id IN (:professionalIds)`,
        { professionalIds },
        transaction,
      );
      requireUniqueRows(
        seededServices,
        (row) => `${row.professional_id}|${row.title}`,
        "Serviços demo após inserção",
      );
      const seededServiceByKey = new Map(
        seededServices.map((row) => [
          `${Number(row.professional_id)}|${row.title}`,
          Number(row.id),
        ]),
      );
      const serviceIds = desiredServices.map((service) => {
        const id = seededServiceByKey.get(
          `${service.professionalId}|${service.title}`,
        );
        if (!id)
          throw new Error(
            `Serviço demo não encontrado após inserção: ${service.title}.`,
          );
        return id;
      });

      await queryInterface.bulkDelete(
        "service_availability",
        { service_id: { [Sequelize.Op.in]: serviceIds } },
        { transaction },
      );
      const providerByProfessionalId = new Map(
        PROVIDERS.map((provider) => [
          professionalByEmail.get(provider.email),
          provider,
        ]),
      );
      const serviceAvailabilityRows = desiredServices.flatMap((service) => {
        const provider = providerByProfessionalId.get(service.professionalId);
        const serviceId = seededServiceByKey.get(
          `${service.professionalId}|${service.title}`,
        );
        return provider.days.map((day) => ({
          service_id: serviceId,
          day_of_week: day,
          start_time: provider.start,
          end_time: provider.end,
          created_at: now,
          updated_at: now,
        }));
      });
      await queryInterface.bulkInsert(
        "service_availability",
        serviceAvailabilityRows,
        { transaction },
      );

      const reviewClients = await selectRows(
        queryInterface,
        Sequelize,
        `SELECT id, main_address_id
         FROM client
         WHERE main_address_id IS NOT NULL
         ORDER BY id
         LIMIT 2`,
        {},
        transaction,
      );
      let reviewRows = [];
      if (reviewClients.length > 0) {
        await queryInterface.bulkDelete(
          "appointment",
          {
            payment_intent_id: {
              [Sequelize.Op.in]: DEMO_REVIEW_PAYMENT_IDS,
            },
          },
          { transaction },
        );

        reviewRows = PROVIDERS.flatMap((provider, providerIndex) => {
          const professionalId = professionalByEmail.get(provider.email);
          const professionalServices = desiredServices.filter(
            (service) => service.professionalId === professionalId,
          );

          return REVIEW_TEMPLATES.map((review, reviewIndex) => {
            const service =
              professionalServices[reviewIndex % professionalServices.length];
            const serviceId = seededServiceByKey.get(
              `${service.professionalId}|${service.title}`,
            );
            const client = reviewClients[reviewIndex % reviewClients.length];
            const startTime = new Date(now);
            startTime.setDate(
              startTime.getDate() - (30 + providerIndex * 2 + reviewIndex),
            );
            startTime.setHours(10 + reviewIndex * 2, 0, 0, 0);
            const endTime = new Date(
              startTime.getTime() + service.duration * 60 * 1000,
            );

            return {
              professional_id: professionalId,
              client_id: Number(client.id),
              service_id: serviceId,
              address_id: Number(client.main_address_id),
              start_time: startTime,
              end_time: endTime,
              completed_at: endTime,
              final_price: (service.priceCents / 100).toFixed(2),
              status: "completed",
              rating: review.rating,
              review: review.text,
              payment_intent_id:
                DEMO_REVIEW_PAYMENT_IDS[
                  providerIndex * REVIEW_TEMPLATES.length + reviewIndex
                ],
              created_at: startTime,
              updated_at: endTime,
            };
          });
        });
        await queryInterface.bulkInsert("appointment", reviewRows, {
          transaction,
        });
      } else {
        console.warn(
          "Nenhum cliente com endereço foi encontrado; avaliações demo não foram criadas.",
        );
      }

      console.log(
        `Catálogo demo completo: ${PROVIDERS.length} prestadores, ${desiredServices.length} serviços, ` +
          `${serviceAvailabilityRows.length} faixas de disponibilidade e ${reviewRows.length} avaliações preparados.`,
      );
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.bulkDelete(
        "appointment",
        {
          payment_intent_id: {
            [Sequelize.Op.in]: DEMO_REVIEW_PAYMENT_IDS,
          },
        },
        { transaction },
      );
      await queryInterface.bulkDelete(
        "users",
        { email: { [Sequelize.Op.in]: DEMO_EMAILS } },
        { transaction },
      );
    });
  },
};
