#!/usr/bin/env python3
"""
Mythril 安全分析脚本
分析编译后的合约字节码，检测安全漏洞
"""

import json
import subprocess
import sys
import os
from pathlib import Path

# 要分析的合约
CONTRACTS = [
    "MOEToken",
    "DepositContract",
    "VestingWalletFactory",
    "StageBasedVestingWallet"
]

def analyze_contract(contract_name):
    """分析单个合约"""
    print(f"\n{'='*60}")
    print(f"分析合约: {contract_name}")
    print(f"{'='*60}\n")

    # 构建artifact路径
    artifact_path = f"artifacts/contracts/{contract_name}.sol/{contract_name}.json"

    if not os.path.exists(artifact_path):
        print(f"❌ 未找到artifact: {artifact_path}")
        return None

    # 读取artifact
    try:
        with open(artifact_path, 'r') as f:
            artifact = json.load(f)
    except Exception as e:
        print(f"❌ 读取artifact失败: {e}")
        return None

    # 获取bytecode和deployedBytecode
    bytecode = artifact.get('bytecode', '')
    deployed_bytecode = artifact.get('deployedBytecode', '')

    if not bytecode or bytecode == '0x':
        print(f"❌ 未找到bytecode")
        return None

    # 创建临时文件保存bytecode
    temp_file = f"/tmp/{contract_name}_bytecode.bin"
    with open(temp_file, 'w') as f:
        f.write(bytecode)

    # 运行Mythril分析
    try:
        # 使用--bin-runtime分析已部署的字节码
        cmd = [
            'myth',
            'analyze',
            '--bin-runtime', deployed_bytecode if deployed_bytecode and deployed_bytecode != '0x' else bytecode,
            '--execution-timeout', '60',
            '--max-depth', '12',
            '--solver-timeout', '10000'
        ]

        print(f"执行命令: {' '.join(cmd[:3])} ...")

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=90
        )

        output = result.stdout + result.stderr

        # 检查是否有发现问题
        if 'SWC' in output or 'Issue' in output:
            print(f"\n⚠️  发现安全问题:\n")
            print(output)
            return output
        elif 'No issues' in output or result.returncode == 0:
            print(f"✅ 未发现安全问题")
            return "No issues found"
        else:
            print(f"⚠️  分析完成，输出:\n{output}")
            return output

    except subprocess.TimeoutExpired:
        print(f"⏱️  分析超时（90秒）")
        return "Timeout"
    except FileNotFoundError:
        print(f"❌ Mythril未安装或未在PATH中")
        print(f"请运行: pip install mythril")
        return None
    except Exception as e:
        print(f"❌ 运行Mythril时出错: {e}")
        return None
    finally:
        # 清理临时文件
        if os.path.exists(temp_file):
            os.remove(temp_file)

def main():
    """主函数"""
    print("\n" + "="*60)
    print("MoeGirls Project - Mythril 安全分析")
    print("="*60)

    results = {}

    for contract in CONTRACTS:
        result = analyze_contract(contract)
        results[contract] = result

    # 生成摘要
    print("\n" + "="*60)
    print("分析摘要")
    print("="*60 + "\n")

    for contract, result in results.items():
        if result is None:
            status = "❌ 失败"
        elif result == "Timeout":
            status = "⏱️  超时"
        elif result == "No issues found":
            status = "✅ 安全"
        elif 'SWC' in result or 'Issue' in result:
            status = "⚠️  发现问题"
        else:
            status = "⚠️  需要人工审查"

        print(f"{contract:30s} {status}")

    # 保存结果
    output_file = "mythril-analysis-results.txt"
    with open(output_file, 'w') as f:
        f.write("MoeGirls Project - Mythril 安全分析结果\n")
        f.write("="*60 + "\n\n")

        for contract, result in results.items():
            f.write(f"\n{'='*60}\n")
            f.write(f"合约: {contract}\n")
            f.write(f"{'='*60}\n\n")

            if result:
                f.write(result)
            else:
                f.write("分析失败或未完成\n")

            f.write("\n\n")

    print(f"\n✅ 完整报告已保存到: {output_file}")

if __name__ == "__main__":
    main()
