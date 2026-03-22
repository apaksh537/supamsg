package com.supamsg.app

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.LayoutInflater
import android.widget.EditText
import android.widget.PopupMenu
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.viewpager2.adapter.FragmentStateAdapter
import androidx.viewpager2.widget.ViewPager2
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.floatingactionbutton.FloatingActionButton
import com.google.android.material.tabs.TabLayout
import com.google.android.material.tabs.TabLayoutMediator

class MainActivity : AppCompatActivity() {

    private lateinit var accountManager: AccountManager
    private lateinit var viewPager: ViewPager2
    private lateinit var tabLayout: TabLayout
    private lateinit var fab: FloatingActionButton
    private lateinit var pagerAdapter: AccountPagerAdapter

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { /* permissions handled */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        accountManager = AccountManager(this)

        viewPager = findViewById(R.id.viewPager)
        tabLayout = findViewById(R.id.tabLayout)
        fab = findViewById(R.id.fab)

        setupViewPager()
        setupFab()
        requestPermissions()
    }

    private fun setupViewPager() {
        pagerAdapter = AccountPagerAdapter(this)
        viewPager.adapter = pagerAdapter
        viewPager.offscreenPageLimit = accountManager.accountCount()
        viewPager.isUserInputEnabled = false // Disable swipe to avoid conflicts with WebView

        TabLayoutMediator(tabLayout, viewPager) { tab, position ->
            val account = accountManager.getAccount(position)
            tab.text = account?.name ?: "Account ${position + 1}"
        }.attach()

        // Long press on tab for rename/remove
        tabLayout.addOnTabSelectedListener(object : TabLayout.OnTabSelectedListener {
            override fun onTabSelected(tab: TabLayout.Tab?) {}
            override fun onTabUnselected(tab: TabLayout.Tab?) {}
            override fun onTabReselected(tab: TabLayout.Tab?) {
                tab?.let { showTabContextMenu(it) }
            }
        })
    }

    private fun showTabContextMenu(tab: TabLayout.Tab) {
        val position = tab.position
        val view = tab.view

        val popup = PopupMenu(this, view)
        popup.menu.add(0, 0, 0, "Rename")
        popup.menu.add(0, 1, 1, "Reload")
        if (accountManager.accountCount() > 1) {
            popup.menu.add(0, 2, 2, "Remove")
        }

        popup.setOnMenuItemClickListener { item ->
            when (item.itemId) {
                0 -> showRenameDialog(position)
                1 -> reloadTab(position)
                2 -> showRemoveDialog(position)
            }
            true
        }
        popup.show()
    }

    private fun showRenameDialog(position: Int) {
        val account = accountManager.getAccount(position) ?: return
        val input = EditText(this).apply {
            setText(account.name)
            setSelection(text.length)
            setPadding(64, 32, 64, 16)
        }

        MaterialAlertDialogBuilder(this)
            .setTitle("Rename Account")
            .setView(input)
            .setPositiveButton("Save") { _, _ ->
                val newName = input.text.toString().trim()
                if (newName.isNotEmpty()) {
                    accountManager.renameAccount(position, newName)
                    tabLayout.getTabAt(position)?.text = newName
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun showRemoveDialog(position: Int) {
        val account = accountManager.getAccount(position) ?: return

        MaterialAlertDialogBuilder(this)
            .setTitle("Remove Account")
            .setMessage("Remove \"${account.name}\"? This will clear its WhatsApp session.")
            .setPositiveButton("Remove") { _, _ ->
                // Clear cache for this account
                val cacheDir = java.io.File(cacheDir, "webview_${account.id}")
                val dataDir = java.io.File(filesDir, "webview_data_${account.id}")
                cacheDir.deleteRecursively()
                dataDir.deleteRecursively()

                accountManager.removeAccount(position)
                refreshPager()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun reloadTab(position: Int) {
        val fragment = supportFragmentManager.findFragmentByTag("f$position")
        if (fragment is WhatsAppFragment) {
            fragment.reload()
        }
    }

    private fun setupFab() {
        fab.setOnClickListener {
            showAddAccountDialog()
        }
    }

    private fun showAddAccountDialog() {
        val input = EditText(this).apply {
            hint = "Account name"
            setPadding(64, 32, 64, 16)
        }

        MaterialAlertDialogBuilder(this)
            .setTitle("Add Account")
            .setView(input)
            .setPositiveButton("Add") { _, _ ->
                val name = input.text.toString().trim()
                if (name.isNotEmpty()) {
                    accountManager.addAccount(name)
                    refreshPager()
                    // Switch to new tab
                    viewPager.setCurrentItem(accountManager.accountCount() - 1, true)
                } else {
                    Toast.makeText(this, "Name cannot be empty", Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun refreshPager() {
        pagerAdapter = AccountPagerAdapter(this)
        viewPager.adapter = pagerAdapter
        viewPager.offscreenPageLimit = accountManager.accountCount()

        TabLayoutMediator(tabLayout, viewPager) { tab, position ->
            val account = accountManager.getAccount(position)
            tab.text = account?.name ?: "Account ${position + 1}"
        }.attach()
    }

    private fun requestPermissions() {
        val perms = mutableListOf<String>()

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
            != PackageManager.PERMISSION_GRANTED
        ) {
            perms.add(Manifest.permission.CAMERA)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_IMAGES)
                != PackageManager.PERMISSION_GRANTED
            ) {
                perms.add(Manifest.permission.READ_MEDIA_IMAGES)
            }
        } else if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE)
                != PackageManager.PERMISSION_GRANTED
            ) {
                perms.add(Manifest.permission.WRITE_EXTERNAL_STORAGE)
            }
        }

        if (perms.isNotEmpty()) {
            permissionLauncher.launch(perms.toTypedArray())
        }
    }

    @Deprecated("Use onBackPressedDispatcher instead")
    override fun onBackPressed() {
        val currentPos = viewPager.currentItem
        val tag = "f$currentPos"
        val fragment = supportFragmentManager.findFragmentByTag(tag)
        if (fragment is WhatsAppFragment && fragment.canGoBack()) {
            fragment.goBack()
        } else {
            super.onBackPressed()
        }
    }

    inner class AccountPagerAdapter(activity: AppCompatActivity) :
        FragmentStateAdapter(activity) {

        override fun getItemCount(): Int = accountManager.accountCount()

        override fun createFragment(position: Int): Fragment {
            val account = accountManager.getAccount(position)
                ?: return WhatsAppFragment.newInstance("default", position)
            return WhatsAppFragment.newInstance(account.id, position)
        }
    }
}
