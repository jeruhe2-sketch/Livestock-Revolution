# -*- coding: utf-8 -*-
"""
창고 재고/이력 데이터를 비밀번호 기반 AES-256-GCM으로 암호화한다.

기존엔 "1004"라는 비밀번호가 자바스크립트 소스에 그대로 박혀있어서 화면만
가리고, 실제 데이터 파일(data/warehouse_stock.json)은 완전히 공개된 정적
파일이라 URL만 알면 누구나 그대로 받아볼 수 있었음. 이 스크립트는 실제
데이터 자체를 암호화해서, 맞는 비밀번호 없이는 파일을 받아가도 읽을 수
없게 만든다.

암호 방식: PBKDF2-HMAC-SHA256(100,000회)로 비밀번호에서 AES-256 키를
유도하고, AES-GCM으로 암호화. 브라우저 표준 Web Crypto API
(SubtleCrypto.decrypt)와 완전히 호환되는 걸 직접 테스트해서 확인함.

암호화된 파일이 매번 완전히 달라지면(랜덤 IV) 실제로는 데이터가 안 바뀌었어도
git이 "변경됨"으로 인식해서 30분마다 불필요한 커밋이 쌓이게 되므로, IV를
"salt로 키를 튼 HMAC-SHA256(평문)"에서 결정론적으로 유도한다. 그러면 같은
평문은 항상 같은 암호문이 나와서 git diff가 진짜 변경이 있을 때만 걸림
(참고로 이건 서로 다른 평문에 대해서는 여전히 서로 다른 IV가 나오므로
AES-GCM의 nonce 재사용 문제는 생기지 않음).

salt는 비밀로 지킬 필요 없음(용도는 레인보우테이블 방지일 뿐) - 그래서
코드에 고정값으로 박아둠. 클라이언트(index.html)에도 반드시 동일한 salt를
써야 함.

사용법:
  python scripts/encrypt_warehouse_data.py --password <비번> <입력.json> <출력.enc.json>
  python scripts/encrypt_warehouse_data.py --password-env WAREHOUSE_PASSWORD <입력.json> <출력.enc.json>
"""
import argparse
import base64
import hashlib
import hmac
import json
import os
import sys

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

# ⚠️ index.html의 WarehousePasswordGate와 반드시 동일해야 함
SALT_B64 = "fBJ+kcVJr/pS0RKeCWNQvg=="
ITERATIONS = 100000


def derive_key(password: str, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITERATIONS)
    return kdf.derive(password.encode("utf-8"))


def deterministic_iv(salt: bytes, plaintext: bytes) -> bytes:
    return hmac.new(salt, plaintext, hashlib.sha256).digest()[:12]


def encrypt_bytes(password: str, plaintext: bytes) -> dict:
    salt = base64.b64decode(SALT_B64)
    key = derive_key(password, salt)
    iv = deterministic_iv(salt, plaintext)
    ciphertext = AESGCM(key).encrypt(iv, plaintext, None)
    return {
        "salt": SALT_B64,
        "iv": base64.b64encode(iv).decode(),
        "iterations": ITERATIONS,
        "ciphertext": base64.b64encode(ciphertext).decode(),
    }


def decrypt_bytes(password: str, enc: dict) -> bytes:
    """검증/디버그용. 실제 서비스에서 복호화는 브라우저(JS)가 함."""
    salt = base64.b64decode(enc["salt"])
    key = derive_key(password, salt)
    iv = base64.b64decode(enc["iv"])
    ciphertext = base64.b64decode(enc["ciphertext"])
    return AESGCM(key).decrypt(iv, ciphertext, None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input", help="입력 파일")
    ap.add_argument("output", help="출력 파일")
    ap.add_argument("--password", help="비밀번호 직접 지정")
    ap.add_argument("--password-env", help="비밀번호가 든 환경변수 이름")
    ap.add_argument("--decrypt", action="store_true", help="지정하면 input(.enc.json)을 복호화해서 output(평문)으로 저장")
    ap.add_argument("--verify", action="store_true", help="(암호화 시) 직후 같은 비번으로 복호화해서 원문과 일치하는지 검증")
    args = ap.parse_args()

    password = args.password or (os.environ.get(args.password_env) if args.password_env else None)
    if not password:
        print("비밀번호가 필요합니다 (--password 또는 --password-env)", file=sys.stderr)
        sys.exit(1)

    if args.decrypt:
        with open(args.input, encoding="utf-8") as f:
            enc = json.load(f)
        plaintext = decrypt_bytes(password, enc)
        with open(args.output, "wb") as f:
            f.write(plaintext)
        print(f"복호화 완료: {args.output} ({len(plaintext)}바이트)", file=sys.stderr)
        return

    with open(args.input, "rb") as f:
        plaintext = f.read()

    enc = encrypt_bytes(password, plaintext)

    if args.verify:
        roundtrip = decrypt_bytes(password, enc)
        if roundtrip != plaintext:
            print("검증 실패: 복호화 결과가 원문과 다름!", file=sys.stderr)
            sys.exit(1)
        print(f"검증 통과: {len(plaintext)}바이트 원문과 일치", file=sys.stderr)

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(enc, f, separators=(",", ":"))
    print(f"암호화 완료: {args.output} ({len(enc['ciphertext'])}자 base64)", file=sys.stderr)


if __name__ == "__main__":
    main()
