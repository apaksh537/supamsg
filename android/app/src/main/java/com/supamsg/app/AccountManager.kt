package com.supamsg.app

import android.content.Context
import android.content.SharedPreferences
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import java.util.UUID

data class Account(
    val id: String = UUID.randomUUID().toString(),
    var name: String,
    var color: String
) {
    companion object {
        val DEFAULT_COLORS = listOf(
            "#25D366", // WhatsApp green
            "#00BCD4", // Cyan
            "#FF9800", // Orange
            "#E91E63", // Pink
            "#9C27B0", // Purple
            "#3F51B5", // Indigo
            "#F44336", // Red
            "#2196F3"  // Blue
        )
    }
}

class AccountManager(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences("supamsg_accounts", Context.MODE_PRIVATE)
    private val gson = Gson()

    private var accounts: MutableList<Account> = loadAccounts()

    private fun loadAccounts(): MutableList<Account> {
        val json = prefs.getString("accounts", null) ?: return createDefaults()
        return try {
            val type = object : TypeToken<MutableList<Account>>() {}.type
            gson.fromJson(json, type) ?: createDefaults()
        } catch (e: Exception) {
            createDefaults()
        }
    }

    private fun createDefaults(): MutableList<Account> {
        val defaults = mutableListOf(
            Account(name = "Personal", color = Account.DEFAULT_COLORS[0]),
            Account(name = "Work", color = Account.DEFAULT_COLORS[1])
        )
        save(defaults)
        return defaults
    }

    private fun save(list: MutableList<Account> = accounts) {
        prefs.edit().putString("accounts", gson.toJson(list)).apply()
    }

    fun getAccounts(): List<Account> = accounts.toList()

    fun getAccount(index: Int): Account? = accounts.getOrNull(index)

    fun addAccount(name: String): Account {
        val colorIndex = accounts.size % Account.DEFAULT_COLORS.size
        val account = Account(name = name, color = Account.DEFAULT_COLORS[colorIndex])
        accounts.add(account)
        save()
        return account
    }

    fun removeAccount(index: Int): Boolean {
        if (index < 0 || index >= accounts.size || accounts.size <= 1) return false
        accounts.removeAt(index)
        save()
        return true
    }

    fun renameAccount(index: Int, newName: String): Boolean {
        if (index < 0 || index >= accounts.size) return false
        accounts[index].name = newName
        save()
        return true
    }

    fun reorderAccounts(fromIndex: Int, toIndex: Int): Boolean {
        if (fromIndex < 0 || fromIndex >= accounts.size ||
            toIndex < 0 || toIndex >= accounts.size
        ) return false
        val account = accounts.removeAt(fromIndex)
        accounts.add(toIndex, account)
        save()
        return true
    }

    fun accountCount(): Int = accounts.size
}
