/*
 * Copyright 2022 The TensorFlow Authors. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *             http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package ph.senya.app.fragment

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.navigation.Navigation
import ph.senya.app.R
import ph.senya.app.databinding.FragmentPermissionsBinding

private val PERMISSIONS_REQUIRED = arrayOf(Manifest.permission.CAMERA)

/** Spec §5.4: if the camera is denied, explain why and offer to ask again. */
class PermissionsFragment : Fragment() {
    private var _binding: FragmentPermissionsBinding? = null
    private var deniedOnce = false

    private val requestPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) {
                navigateToCamera()
            } else {
                deniedOnce = true
                _binding?.explanation?.visibility = View.VISIBLE
            }
        }

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        val binding = FragmentPermissionsBinding.inflate(inflater, container, false)
        _binding = binding
        binding.grantButton.setOnClickListener { requestOrOpenSettings() }
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        if (hasPermissions(requireContext())) navigateToCamera()
        else requestPermissionLauncher.launch(Manifest.permission.CAMERA)
    }

    override fun onResume() {
        super.onResume()
        // Back from the system settings screen with the permission granted
        if (deniedOnce && hasPermissions(requireContext())) navigateToCamera()
    }

    override fun onDestroyView() {
        _binding = null
        super.onDestroyView()
    }

    private fun requestOrOpenSettings() {
        if (deniedOnce && !shouldShowRequestPermissionRationale(Manifest.permission.CAMERA)) {
            // "Don't ask again": only the system settings screen can grant it now
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", requireContext().packageName, null)))
        } else {
            requestPermissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    private fun navigateToCamera() {
        lifecycleScope.launchWhenStarted {
            Navigation.findNavController(requireActivity(), R.id.fragment_container)
                .navigate(R.id.action_permissions_to_camera)
        }
    }

    companion object {
        /** Convenience method used to check if all permissions required by this app are granted */
        fun hasPermissions(context: Context) = PERMISSIONS_REQUIRED.all {
            ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
        }
    }
}
