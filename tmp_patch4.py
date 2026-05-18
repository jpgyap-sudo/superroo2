with open('cloud/dashboard/src/components/ide-terminal/AiChatPanel.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

old = '''\t\t\t\t\t\t{tab.icon}
\t\t\t\t\t\t{tab.label}
\t\t\t\t\t</button>
\t\t\t\t))}
\t\t\t</div>'''

new = '''\t\t\t\t\t\t{tab.icon}
\t\t\t\t\t\t{tab.label}
\t\t\t\t\t</button>
\t\t\t\t))}
\t\t\t\t<div className="flex-1" />
\t\t\t\t{onClearChat && (
\t\t\t\t\t<button
\t\t\t\t\t\tclassName="flex items-center gap-1 px-2.5 py-1.5 text-[11px] text-[#8b949e] hover:text-[#f85149] hover:bg-[#f8514911] transition-colors"
\t\t\t\t\t\tonClick={onClearChat}
\t\t\t\t\t\ttitle="Clear chat history">
\t\t\t\t\t\t<X className="w-3.5 h-3.5" />
\t\t\t\t\t\tClear
\t\t\t\t\t</button>
\t\t\t\t)}
\t\t\t</div>'''

if old in content:
    content = content.replace(old, new, 1)
    with open('cloud/dashboard/src/components/ide-terminal/AiChatPanel.tsx', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Inserted clear chat button")
else:
    print("Old string not found")
