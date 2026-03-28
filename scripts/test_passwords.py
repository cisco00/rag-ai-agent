import bcrypt

hashed = '$2b$12$YamFLh1G8K5CQuKhdzFu6eZVRv69VXOJ.kYV7mW9cu37ydNN1tgm6'
passwords = ['admin123', 'admin', 'password', 'password123', 'Otium123', 'otium123', 'vantage', 'vantage123']

found = False
for pw in passwords:
    if bcrypt.checkpw(pw.encode(), hashed.encode()):
        print(f"PASSWORD FOUND: {pw}")
        found = True
        break

if not found:
    print("Password not in common list.")
