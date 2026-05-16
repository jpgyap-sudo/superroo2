#!/usr/bin/env python3
"""
Fix the duplicate code in telegramBot.js - remove the old handleEmailOtpLogin
code that was left behind after the replacement.
"""
import re

def main():
    path = "/opt/superroo2/cloud/api/telegramBot.js"
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Find the pattern: after the new function's closing brace, there's old code
    # The new function ends with:
    #   }
    # }
    # 
    # \t// Generate a 6-digit OTP  <-- this is the old code starting
    #
    # We need to remove from "\t// Generate a 6-digit OTP" up to the next
    # function declaration or the end of the old function
    
    # Find the duplicate old code - it starts with the comment about generating OTP
    # that appears AFTER the new function's closing brace
    pattern = r'(\t\}\n\}\n\n)\t// Generate a 6-digit OTP\n.*?(?=\n/\*\*\n \* Handles OTP code verification)'
    
    replacement = r'\1'
    
    new_content = re.sub(pattern, replacement, content, count=1, flags=re.DOTALL)
    
    if new_content == content:
        print("ERROR: Could not find duplicate code pattern")
        # Let's debug - find where the duplicate starts
        idx = content.find("\t// Generate a 6-digit OTP")
        idx2 = content.find("\t// Generate a 6-digit OTP", idx + 10)
        print(f"First occurrence at: {idx}")
        print(f"Second occurrence at: {idx2}")
        sys.exit(1)
    
    with open(path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("✅ Removed duplicate old code")
    
    # Verify syntax
    import subprocess
    result = subprocess.run(["node", "--check", path], capture_output=True, text=True)
    if result.returncode != 0:
        print("❌ Syntax error:", result.stderr)
        sys.exit(1)
    print("✅ Syntax OK")

if __name__ == "__main__":
    import sys
    main()
