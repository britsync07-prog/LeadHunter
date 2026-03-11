import fs from 'fs';
let text = fs.readFileSync('public/app.js', 'utf8');

const replacements = [
    [/< option /g, '<option '],
    [/<\/option >/g, '</option>'],
    [/< input /g, '<input '],
    [/< p /g, '<p '],
    [/<\/p >/g, '</p>'],
    [/< div /g, '<div '],
    [/<\/div >/g, '</div>'],
    [/< button /g, '<button '],
    [/<\/button >/g, '</button>'],
    [/\/ api \/ /g, '/api/'],
    [/\/ api \//g, '/api/'],
    [/emails - /g, 'emails-'],
    [/emails -/g, 'emails-'],
    [/& ndash;/g, '&ndash;'],
    [/& #x25A0;/g, '&#x25A0;'],
    [/\? country = /g, '?country='],
    [/sec - /g, 'sec-'],
    [/\${job.id} /g, '${job.id}']
];

for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
}

fs.writeFileSync('public/app.js', text);
console.log("Fixed apps.js!");
