/* Configuração pública do Supabase (a chave "publishable" foi feita para ficar no navegador;
   quem protege os dados são as regras de segurança por linha — RLS — do banco). Nunca coloque aqui a service_role.

   Dois ambientes, escolhidos pelo ENDEREÇO em que o site está aberto:
   - produção: só nos endereços oficiais listados em HOSTS_PRODUCAO (banco com os dados reais);
   - homologação: QUALQUER outro endereço (prévias da Vercel, localhost...) — banco separado, só dados de teste.
   Assim, um endereço novo ou desconhecido nunca escreve por engano no banco real. */
(function () {
  var PRODUCAO = {
    ambiente: 'producao',
    url: 'https://jkhjixfdlpucaebulpdh.supabase.co',
    key: 'sb_publishable_nmJpauAc7MRBYLmNfm37jA_QXtgNtuV'
  };
  var HOMOLOGACAO = {
    ambiente: 'homologacao',
    url: 'https://azkvclwozhneyougtcbn.supabase.co',
    key: 'sb_publishable_tKung_iL7gHzW-ZmWA-Sew_fN9O3FO8'
  };
  var HOSTS_PRODUCAO = ['sistema.henriquedurant.com', 'painel.henriquedurant.com', 'durant-atelie.vercel.app'];
  var host = String(location.hostname || '').toLowerCase();
  window.SUPABASE_CFG = HOSTS_PRODUCAO.indexOf(host) >= 0 ? PRODUCAO : HOMOLOGACAO;
})();
