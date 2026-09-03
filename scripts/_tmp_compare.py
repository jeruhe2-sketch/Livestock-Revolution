import json

local = json.load(open("data/warehouse_stock.enc.json"))
pages = json.load(open("/tmp/pages_version.json"))
print("local salt:", local["salt"])
print("pages salt:", pages["salt"])
print("local ciphertext[:30]:", local["ciphertext"][:30])
print("pages ciphertext[:30]:", pages["ciphertext"][:30])
print("완전히 동일함:", local["ciphertext"] == pages["ciphertext"])
