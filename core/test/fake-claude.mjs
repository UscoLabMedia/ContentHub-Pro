// Stand-in for the `claude` CLI used by tests.
let input = '';
process.stdin.on('data', (d) => (input += d)).on('end', () => {
  const args = process.argv.slice(2);
  if (args[0] === 'auth') return console.log(JSON.stringify({ loggedIn: process.env.FAKE_MODE !== 'loggedout' }));
  if (process.env.FAKE_MODE === 'error') return console.log(JSON.stringify({ is_error: true, result: 'Not logged in - Please run /login' }));
  const flag = (n) => args[args.indexOf(n) + 1];
  const title = [flag('--model'), JSON.stringify(flag('--tools')), input.includes('ESQUEMA JSON'), args.includes('--no-session-persistence')].join('|');
  console.log(JSON.stringify({ is_error: false, result: 'Aqui esta:\n' + JSON.stringify({ trends: [{ title, context: 'c', virality: 5 }] }), usage: { input_tokens: 10, output_tokens: 5 } }));
});
