const fs = require('fs');
const path = require('path');

function commentForExt(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.html' || ext === '.htm') return { start: '<!-- ', end: ' -->' };
    if (ext === '.js' || ext === '.jsx' || ext === '.ts' || ext === '.css' || ext === '.scss') return { start: '/* ', end: ' */' };
    return { start: '/* ', end: ' */' };
}

function walk(dir) {
    const res = [];
    for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name);
        const stat = fs.statSync(p);
        if (stat.isDirectory()) {
            res.push(...walk(p));
        } else {
            res.push(p);
        }
    }
    return res;
}

const root = path.resolve(__dirname, '..');
const files = walk(root);
const conflictRegex = /<<<<<<< HEAD\r?\n([\s\S]*?)\r?\n=======(?:\r?\n)([\s\S]*?)\r?\n>>>>>>>[^\r\n]*\r?\n?/g;

const modified = [];
for (const file of files) {
    // skip node scripts, git and binary-ish
    if (file.includes('.git') || file.includes('node_modules') || file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.jpeg') || file.endsWith('.gif') || file.endsWith('.ico')) continue;
    let src = fs.readFileSync(file, 'utf8');
    if (!src.includes('<<<<<<< HEAD')) continue;
    const comment = commentForExt(file);
    const newSrc = src.replace(conflictRegex, (m, head, incoming) => {
        // Trim optional leading/trailing newlines to keep formatting tidy
        const headTrim = head.replace(/^\n+|\n+$/g, '');
        const incomingTrim = incoming.replace(/^\n+|\n+$/g, '');
        const commentedIncoming = `${comment.start}BEGIN incoming (reyn/ulan)\n${incomingTrim}\nEND incoming (reyn/ulan)${comment.end}`;
        return headTrim + '\n' + commentedIncoming + '\n';
    });
    if (newSrc !== src) {
        fs.writeFileSync(file, newSrc, 'utf8');
        modified.push(path.relative(root, file));
    }
}

if (modified.length === 0) {
    console.log('No conflict markers found.');
} else {
    console.log('Modified files:\n' + modified.join('\n'));
}
