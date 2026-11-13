// Serves fastify-multer 2.0.3 on Fastify 4 (it can't start on Fastify 5), sends it the multipart
// body given on stdin, and prints the response. Run in a child process, since a crash ends it.
const Fastify = require('fastify4');
const fastifyMulter = require('fastify-multer');

const [contentType] = process.argv.slice(2);
const chunks = [];
process.stdin.on('data', chunk => chunks.push(chunk));
process.stdin.on('end', async () => {
	const app = Fastify();
	app.register(fastifyMulter.contentParser);
	app.post('/', {preHandler: fastifyMulter().none()}, async request => ({fields: Object.keys(request.body).length}));
	const response = await app.inject({method: 'POST', url: '/', headers: {'content-type': contentType}, payload: Buffer.concat(chunks)});
	console.log(JSON.stringify({statusCode: response.statusCode, body: response.body}));
	await app.close();
});
