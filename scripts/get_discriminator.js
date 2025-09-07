const crypto = require('crypto');

// Función para calcular discriminator de Anchor
function getDiscriminator(namespace, name) {
    const preimage = `${namespace}:${name}`;
    const hash = crypto.createHash('sha256').update(preimage).digest();
    return Array.from(hash.slice(0, 8));
}

// Calcular discriminator para buy_team
const buyTeamDiscriminator = getDiscriminator('global', 'buy_team');
console.log('buy_team discriminator:', buyTeamDiscriminator);
console.log('buy_team discriminator (hex):', Buffer.from(buyTeamDiscriminator).toString('hex'));

// Otros discriminators útiles
const initializeDiscriminator = getDiscriminator('global', 'initialize');
console.log('initialize discriminator:', initializeDiscriminator);

const stakeTeamDiscriminator = getDiscriminator('global', 'stake_team');
console.log('stake_team discriminator:', stakeTeamDiscriminator);
