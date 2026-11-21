import re, sys
t = open(sys.argv[1], errors='replace').read()
m = re.findall(r'mismatches\W{0,6}:\s*(\d+)', t)
g = re.findall(r'unexpectedGaps\W{0,6}:\s*(\d+)', t)
print('mismatches', m[-1:], 'unexpectedGaps', g[-1:])
sys.exit(0 if m and g and m[-1] == '0' and g[-1] == '0' else 1)
