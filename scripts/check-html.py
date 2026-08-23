"""Parser independente do browser: valida balanceamento de tags e ausencia de
self-closing em elementos nao-void num arquivo HTML. Uso: check-html.py file"""
import sys
from html.parser import HTMLParser

VOID = {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}

class P(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.problems = []
    def handle_starttag(self, tag, attrs):
        if tag not in VOID:
            self.stack.append(tag)
    def handle_startendtag(self, tag, attrs):
        if tag not in VOID:
            self.problems.append(f'self-closing em nao-void: <{tag}/>')
    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if tag in self.stack:
            while self.stack and self.stack.pop() != tag:
                pass
        else:
            self.problems.append(f'fechamento sem abertura: </{tag}>')

p = P()
p.feed(open(sys.argv[1], encoding='utf-8').read())
p.close()
if p.stack:
    p.problems.append('tags nao fechadas: ' + ','.join(p.stack))
print(('HTML OK' if not p.problems else 'HTML RUIM: ' + ' | '.join(p.problems)))
