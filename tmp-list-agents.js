const ar = require('./cloud/agent-runtime/agentRegistry');
ar.listAgents()
  .then((a) => {
    console.log('count', a.length);
    console.log(JSON.stringify(a.map((x) => x.id)));
  })
  .catch((e) => {
    console.error('ERR', e.message);
    process.exit(1);
  });
