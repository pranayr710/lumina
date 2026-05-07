import os
import re

def fix():
    # Folder renames were done: components->c, lib->l, models->m, venv->v, shots->s
    replacements = {
        r'@/c/': '@/c/',
        r'@/l/': '@/l/',
        r'm/': 'm/',
        r'm/': 'm/',
        r's/': 's/',
        r's/': 's/',
        r'v/': 'v/',
        r'v/': 'v/',
        r'brain': 'brain',
        r'vis': 'vis',
        r'aud': 'aud',
        r'from brain import': 'from brain import',
        r'from vis import': 'from vis import',
        r'from aud import': 'from aud import',
    }

    for root, dirs, files in os.walk('.'):
        if any(x in root for x in ['node_modules', '.git', '.next', 'v']):
            continue
        for file in files:
            if not file.endswith(('.tsx', '.ts', '.js', '.py', '.json', '.css')):
                continue
            path = os.path.join(root, file)
            with open(path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
            
            orig = content
            for old, new in replacements.items():
                content = re.sub(old, new, content)
            
            if content != orig:
                with open(path, 'w', encoding='utf-8') as f:
                    f.write(content)
                print(f"Updated {path}")

if __name__ == "__main__":
    fix()
