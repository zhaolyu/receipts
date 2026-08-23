Before auditing this fixture, generate the oversize file (not checked in):
  head -c 3000000 /dev/urandom > fixtures/broken-repo/blob.bin
The fixture runner (`npm run fixtures`) must create it if absent and leave it gitignored.
